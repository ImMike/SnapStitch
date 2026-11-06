// Offscreen document that records a tab. Pipeline:
//   tab capture → latest frame → compositor canvas (crop + cursor + ripples)
//   → MediaStreamTrackGenerator → MediaRecorder (MP4)
//                               → downscaled samples → gif-worker (GIF)
// The service worker creates this document per recording and closes it after
// 'recording-done'.
import { putShot, pruneShots } from './db.js';

const HEARTBEAT_MS = 1000; // re-emit a frame at least this often
const GIF_INTERVAL_MS = 100; // ≤ 10 fps
const GIF_MAX_WIDTH = 800;
const RIPPLE_MS = 450;
const ARROW = new Path2D('M0 0 L0 17 L4.2 13.2 L7 19.5 L9.6 18.4 L6.9 12.3 L12.3 12.3 Z');

let session = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'recorder-start') {
    start(msg).then(() => sendResponse({ ok: true }), (err) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'recorder-stop') session?.stop(false);
  if (msg.type === 'recorder-cancel') session?.stop(true);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'snapstitch-cursor' && session) session.addCursorPort(port);
});

async function start({ streamId, rect, innerWidth, innerHeight, dpr, mode, url, title, maxMs }) {
  const W = Math.round(innerWidth * dpr);
  const H = Math.round(innerHeight * dpr);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab', chromeMediaSourceId: streamId,
        minWidth: W, maxWidth: W, minHeight: H, maxHeight: H, maxFrameRate: 30,
      },
    },
  });
  const [track] = stream.getVideoTracks();
  // Native size: otherwise Chrome may rescale frames to fit the constraints.
  await track.applyConstraints({ resizeMode: 'none' });
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  let latest = (await reader.read()).value;

  // Source rect in device px. H.264 needs even dimensions.
  const scale = latest.displayWidth / innerWidth;
  const r = rect ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const src = { x: Math.round(r.x * scale), y: Math.round(r.y * scale) };
  src.w = Math.min(Math.round(r.width * scale), latest.displayWidth - src.x) & ~1;
  src.h = Math.min(Math.round(r.height * scale), latest.displayHeight - src.y) & ~1;
  if (src.w < 2 || src.h < 2) throw new Error('Selected area is too small to record.');

  // CPU-backed canvas on purpose: frames from a GPU canvas reach MediaRecorder
  // without color tagging and saturated colors shift (see docs/chrome-notes.md).
  const canvas = new OffscreenCanvas(src.w, src.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gifW = Math.min(GIF_MAX_WIDTH, src.w);
  const gifH = Math.max(1, Math.round((src.h * gifW) / src.w));
  const gifCtx = new OffscreenCanvas(gifW, gifH).getContext('2d', { willReadFrequently: true });
  gifCtx.imageSmoothingQuality = 'high';
  const gifWorker = new Worker('gif-worker.js', { type: 'module' });

  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = generator.writable.getWriter();
  const mimeType = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(new MediaStream([generator]), {
    mimeType,
    videoBitsPerSecond: Math.min(12e6, Math.max(2e6, src.w * src.h * 30 * 0.1)),
  });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const cursor = { x: 0, y: 0, visible: false };
  let ripples = [];
  const ports = new Set();
  let dirty = true;
  let writing = null; // pending write; while set, new frames are skipped
  let lastEmit = -Infinity;
  let lastGif = -Infinity;
  let lastTick = -1;
  let stopping = false;
  const t0 = performance.now();

  // Sends the canvas to the recorder. VideoFrame requires a timestamp, but
  // MediaRecorder times frames by when they arrive.
  function emit(now) {
    writing = writer.write(new VideoFrame(canvas, { timestamp: Math.round((now - t0) * 1000) }))
      .finally(() => (writing = null));
  }

  function compose(now) {
    dirty = false;
    lastEmit = now;
    ctx.drawImage(latest, src.x, src.y, src.w, src.h, 0, 0, src.w, src.h);
    for (const ripple of ripples) drawRipple(ripple, (now - ripple.t) / RIPPLE_MS);
    if (cursor.visible) drawCursor();
    emit(now);
    if (now - lastGif >= GIF_INTERVAL_MS) {
      lastGif = now;
      gifCtx.drawImage(canvas, 0, 0, gifW, gifH);
      const { data } = gifCtx.getImageData(0, 0, gifW, gifH);
      gifWorker.postMessage({ type: 'frame', rgba: data.buffer, width: gifW, height: gifH, time: now - t0 },
        [data.buffer]);
    }
  }

  // Page coordinates (CSS px) → canvas px.
  const toCanvas = (x, y) => [x * scale - src.x, y * scale - src.y];

  function drawCursor() {
    const [x, y] = toCanvas(cursor.x, cursor.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.fill(ARROW);
    ctx.stroke(ARROW);
    ctx.restore();
  }

  function drawRipple(ripple, p) {
    const [x, y] = toCanvas(ripple.x, ripple.y);
    ctx.beginPath();
    ctx.arc(x, y, (6 + 20 * p) * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(79, 70, 229, ${0.25 * (1 - p)})`;
    ctx.fill();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = `rgba(79, 70, 229, ${1 - p})`;
    ctx.stroke();
  }

  // Tab capture only delivers frames when the page changes, so the compositor
  // runs on its own clock: cursor movement and ripples need frames too.
  const ticker = new Worker('ticker.js');
  ticker.onmessage = () => {
    const now = performance.now();
    const elapsed = Math.floor((now - t0) / 1000);
    if (elapsed !== lastTick) {
      lastTick = elapsed;
      chrome.runtime.sendMessage({ type: 'recording-tick', elapsed });
    }
    if (now - t0 >= maxMs) return stop(false);
    ripples = ripples.filter((ripple) => now - ripple.t < RIPPLE_MS);
    const due = dirty || ripples.length || now - lastEmit >= HEARTBEAT_MS;
    if (due && !writing) compose(now);
  };

  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      latest.close();
      latest = value;
      dirty = true;
    }
    stop(false); // track ended: the tab was closed or stopped being capturable
  })().catch(() => {});

  async function stop(discard) {
    if (stopping) return;
    stopping = true;
    ticker.terminate();
    for (const port of ports) port.disconnect(); // removes the in-page UI
    try {
      await writing;
      const end = performance.now();
      if (!discard) {
        // Last frame, so the video runs until now. MediaRecorder times frames
        // by arrival (not VideoFrame.timestamp) and drops any still being
        // encoded when recording ends, so give this one time to get through
        // and end on a throwaway duplicate instead (see docs/chrome-notes.md).
        compose(end);
        await writing;
        await new Promise((resolve) => setTimeout(resolve, 100));
        emit(performance.now());
      }
      await writing;
      reader.cancel();
      track.stop();
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      await writer.close();
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      latest.close();

      if (discard) {
        gifWorker.terminate();
        chrome.runtime.sendMessage({ type: 'recording-done', id: null });
        return;
      }
      const gifDone = new Promise((resolve) => (gifWorker.onmessage = (e) => resolve(e.data.bytes)));
      gifWorker.postMessage({ type: 'finish', time: end - t0 });
      const gif = new Blob([await gifDone], { type: 'image/gif' });
      gifWorker.terminate();

      const id = crypto.randomUUID();
      await putShot({
        id, kind: 'video', mode, url, title,
        video: new Blob(chunks, { type: recorder.mimeType.split(';')[0] }),
        gif,
        width: src.w,
        height: src.h,
        duration: (end - t0) / 1000,
        createdAt: Date.now(),
      });
      await pruneShots();
      chrome.runtime.sendMessage({ type: 'recording-done', id });
    } catch (err) {
      chrome.runtime.sendMessage({ type: 'recording-error', message: err.message });
    }
  }

  session = {
    stop,
    addCursorPort(port) {
      ports.add(port);
      port.onDisconnect.addListener(() => ports.delete(port));
      port.onMessage.addListener((msg) => {
        if (msg.hidden) {
          cursor.visible = false;
        } else {
          Object.assign(cursor, { x: msg.x, y: msg.y, visible: true });
          if (msg.click) ripples.push({ x: msg.x, y: msg.y, t: performance.now() });
        }
        dirty = true;
      });
    },
  };
  recorder.start(1000);
}
