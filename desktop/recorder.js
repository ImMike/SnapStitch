// Hidden window that records one screen with the extension's pipeline
// (src/rec-core.js), streaming the video to main.js as it goes. The real
// pointer is part of the screen capture, so nothing is drawn on top.
import { startRecording } from '../src/rec-core.js';

const api = window.snapstitch;

try {
  const { sourceId, width, height, crop, maxMs } = await api.invoke('recorder-config');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId,
        minWidth: width, maxWidth: width, minHeight: height, maxHeight: height, maxFrameRate: 30,
      },
    },
  });
  const [track] = stream.getVideoTracks();
  // Native size: otherwise frames may be rescaled to fit the constraints.
  await track.applyConstraints({ resizeMode: 'none' });

  let sending = Promise.resolve(); // keeps chunks in order
  const recording = await startRecording({
    track,
    maxMs,
    crop(frameWidth) {
      const k = frameWidth / width; // 1 unless the frames come in another size
      return { x: crop.x * k, y: crop.y * k, w: crop.w * k, h: crop.h * k };
    },
    onTick: (elapsed) => api.send('rec-tick', elapsed),
    onStopping: () => api.send('rec-stopping'),
    onData: (blob) => {
      sending = sending.then(async () => api.send('rec-data', new Uint8Array(await blob.arrayBuffer())));
    },
  });
  api.on('rec-stop', ({ discard }) => recording.stop(discard));
  api.send('rec-started');

  const result = await recording.done;
  await sending;
  api.send('rec-done', result && {
    gif: new Uint8Array(await result.gif.arrayBuffer()),
    videoType: result.videoType,
    width: result.width,
    height: result.height,
    duration: result.duration,
  });
} catch (err) {
  api.send('rec-error', err.message);
}
