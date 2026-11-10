// Offscreen document that records a tab. The pipeline itself is in
// rec-core.js; this adds tab capture, the drawn cursor and click ripples (tab
// capture can't see the real pointer), and saving.
// The service worker creates this document per recording and closes it after
// 'recording-done'.
import { putShot, pruneShots } from './db.js';
import { startRecording } from './rec-core.js';

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

  const cursor = { x: 0, y: 0, visible: false };
  let ripples = [];
  const ports = new Set();
  let scale = 1; // frame px per CSS px
  let src = null;

  // Page coordinates (CSS px) → canvas px.
  const toCanvas = (x, y) => [x * scale - src.x, y * scale - src.y];

  function drawCursor(ctx) {
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

  function drawRipple(ctx, ripple, p) {
    const [x, y] = toCanvas(ripple.x, ripple.y);
    ctx.beginPath();
    ctx.arc(x, y, (6 + 20 * p) * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(79, 70, 229, ${0.25 * (1 - p)})`;
    ctx.fill();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = `rgba(79, 70, 229, ${1 - p})`;
    ctx.stroke();
  }

  const recording = await startRecording({
    track,
    maxMs,
    crop(width) {
      scale = width / innerWidth;
      const r = rect ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
      src = { x: Math.round(r.x * scale), y: Math.round(r.y * scale), w: r.width * scale, h: r.height * scale };
      return src;
    },
    overlay: {
      draw(ctx, now) {
        for (const ripple of ripples) drawRipple(ctx, ripple, (now - ripple.t) / RIPPLE_MS);
        if (cursor.visible) drawCursor(ctx);
      },
      active(now) {
        ripples = ripples.filter((ripple) => now - ripple.t < RIPPLE_MS);
        return ripples.length > 0;
      },
    },
    onTick: (elapsed) => chrome.runtime.sendMessage({ type: 'recording-tick', elapsed }),
    onStopping: () => {
      for (const port of ports) port.disconnect(); // removes the in-page UI
    },
  });

  recording.done.then(async (result) => {
    if (!result) return chrome.runtime.sendMessage({ type: 'recording-done', id: null });
    const id = crypto.randomUUID();
    const { video, gif, width, height, duration } = result;
    await putShot({ id, kind: 'video', mode, url, title, video, gif, width, height, duration, createdAt: Date.now() });
    await pruneShots();
    chrome.runtime.sendMessage({ type: 'recording-done', id });
  }).catch((err) => chrome.runtime.sendMessage({ type: 'recording-error', message: err.message }));

  session = {
    stop: (discard) => recording.stop(discard),
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
        recording.markDirty();
      });
    },
  };
}
