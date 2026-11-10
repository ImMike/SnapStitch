// Recording pipeline shared by the extension (src/recorder.js, tab capture) and
// SnapStitch Desktop (desktop/recorder.js, screen capture):
//   video track → latest frame → compositor canvas (crop + caller's overlay)
//   → MediaStreamTrackGenerator → MediaRecorder (MP4)
//                               → downscaled samples → gif-worker (GIF)
// Web APIs only: no chrome.* and no storage, so both callers can use it.

const HEARTBEAT_MS = 1000; // re-emit a frame at least this often
const GIF_INTERVAL_MS = 100; // ≤ 10 fps
const GIF_MAX_WIDTH = 800;

// Starts recording `track`. Resolves once the first frame has arrived, with
//   { width, height, stop(discard), markDirty(), done }
// `done` resolves when recording ends for any reason (stop, maxMs, track
// ended) with { video, gif, width, height, duration }, or null if discarded.
//
// crop(frameWidth, frameHeight) → { x, y, w, h } in frame pixels.
// overlay (optional): { draw(ctx, now), active(now) } draws on top of each
//   frame; active() returning true keeps frames coming (e.g. animations).
// onTick(elapsedSeconds) is called once per second, onStopping() as soon as
// recording stops (before encoding finishes), onData(blob) if given receives
// the video chunks instead of `done` (result.video is then null).
export async function startRecording({ track, crop, overlay, maxMs, onTick, onStopping, onData }) {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  let latest = (await reader.read()).value;

  // H.264 needs even dimensions.
  const r = crop(latest.displayWidth, latest.displayHeight);
  const src = { x: Math.round(r.x), y: Math.round(r.y) };
  src.w = Math.min(Math.round(r.w), latest.displayWidth - src.x) & ~1;
  src.h = Math.min(Math.round(r.h), latest.displayHeight - src.y) & ~1;
  if (src.x < 0 || src.y < 0 || src.w < 2 || src.h < 2) {
    latest.close();
    reader.cancel();
    throw new Error('Selected area is too small to record.');
  }

  // CPU-backed canvas on purpose: frames from a GPU canvas reach MediaRecorder
  // without color tagging and saturated colors shift (see docs/chrome-notes.md).
  const canvas = new OffscreenCanvas(src.w, src.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gifW = Math.min(GIF_MAX_WIDTH, src.w);
  const gifH = Math.max(1, Math.round((src.h * gifW) / src.w));
  const gifCtx = new OffscreenCanvas(gifW, gifH).getContext('2d', { willReadFrequently: true });
  gifCtx.imageSmoothingQuality = 'high';
  const gifWorker = new Worker(new URL('./gif-worker.js', import.meta.url), { type: 'module' });

  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = generator.writable.getWriter();
  const mimeType = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(new MediaStream([generator]), {
    mimeType,
    videoBitsPerSecond: Math.min(12e6, Math.max(2e6, src.w * src.h * 30 * 0.1)),
  });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    if (onData) onData(e.data);
    else chunks.push(e.data);
  };

  let dirty = true;
  let writing = null; // pending write; while set, new frames are skipped
  let lastEmit = -Infinity;
  let lastGif = -Infinity;
  let lastTick = -1;
  let stopping = false;
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => ([resolveDone, rejectDone] = [resolve, reject]));
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
    overlay?.draw(ctx, now);
    emit(now);
    if (now - lastGif >= GIF_INTERVAL_MS) {
      lastGif = now;
      gifCtx.drawImage(canvas, 0, 0, gifW, gifH);
      const { data } = gifCtx.getImageData(0, 0, gifW, gifH);
      gifWorker.postMessage({ type: 'frame', rgba: data.buffer, width: gifW, height: gifH, time: now - t0 },
        [data.buffer]);
    }
  }

  // Captured tracks may only deliver frames when the picture changes, so the
  // compositor runs on its own clock: overlays need frames too.
  const ticker = new Worker(new URL('./ticker.js', import.meta.url));
  ticker.onmessage = () => {
    const now = performance.now();
    const elapsed = Math.floor((now - t0) / 1000);
    if (elapsed !== lastTick) {
      lastTick = elapsed;
      onTick?.(elapsed);
    }
    if (now - t0 >= maxMs) return stop(false);
    const animating = overlay?.active(now);
    const due = dirty || animating || now - lastEmit >= HEARTBEAT_MS;
    if (due && !writing) compose(now);
  };

  (async () => {
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      latest.close();
      latest = value;
      dirty = true;
    }
    stop(false); // track ended: the source went away
  })().catch(() => {});

  function stop(discard) {
    if (!stopping) {
      stopping = true;
      finish(discard).then(resolveDone, rejectDone);
    }
    return done;
  }

  async function finish(discard) {
    ticker.terminate();
    onStopping?.();
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
      return null;
    }
    const gifDone = new Promise((resolve) => (gifWorker.onmessage = (e) => resolve(e.data.bytes)));
    gifWorker.postMessage({ type: 'finish', time: end - t0 });
    const gif = new Blob([await gifDone], { type: 'image/gif' });
    gifWorker.terminate();
    return {
      video: onData ? null : new Blob(chunks, { type: recorder.mimeType.split(';')[0] }),
      videoType: recorder.mimeType.split(';')[0],
      gif,
      width: src.w,
      height: src.h,
      duration: (end - t0) / 1000,
    };
  }

  recorder.start(1000);
  return { width: src.w, height: src.h, stop, markDirty: () => (dirty = true), done };
}
