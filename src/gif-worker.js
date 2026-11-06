// Encodes recording frames into a looping GIF off the recorder's main thread.
//   in:  { type: 'frame', rgba: ArrayBuffer, width, height, time }  (time in ms)
//        { type: 'finish', time }
//   out: { bytes: ArrayBuffer }  (after finish)
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.esm.js';

const gif = GIFEncoder();
let pending = null; // written once the next frame tells us how long it lasts
let writtenCs = 0; // total delay written so far, in GIF centiseconds

function write(frame, until) {
  // Delays are derived from the running total so rounding to centiseconds
  // never drifts. Browsers treat delays under 2cs as 10cs, so never go below.
  const delayCs = Math.max(2, Math.round(until / 10) - writtenCs);
  writtenCs += delayCs;
  const palette = quantize(frame.rgba, 256);
  const index = applyPalette(frame.rgba, palette);
  gif.writeFrame(index, frame.width, frame.height, { palette, delay: delayCs * 10 });
}

function sameImage(a, b) {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer);
  const y = new Uint32Array(b.buffer);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

onmessage = ({ data }) => {
  if (data.type === 'frame') {
    const rgba = new Uint8Array(data.rgba);
    // Unchanged screen: let the previous frame last longer instead.
    if (pending && sameImage(pending.rgba, rgba)) return;
    if (pending) write(pending, data.time);
    pending = { rgba, width: data.width, height: data.height, time: data.time };
  } else if (data.type === 'finish') {
    if (pending) write(pending, data.time);
    gif.finish();
    const bytes = gif.bytes();
    postMessage({ bytes: bytes.buffer }, [bytes.buffer]);
  }
};
