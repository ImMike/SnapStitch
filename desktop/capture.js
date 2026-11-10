// Screenshot helpers for main.js. Separate so test/capture.test.js can check
// the pixel work without starting the app.
const { desktopCapturer, nativeImage, screen } = require('electron');

const displayAtCursor = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
const physical = (d) => ({ width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) });

// "Screen 2 of 3 (main)", numbered left to right.
function displayLabel(display, all = screen.getAllDisplays(), primaryId = screen.getPrimaryDisplay().id) {
  const sorted = [...all].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  const index = sorted.findIndex((d) => d.id === display.id);
  if (sorted.length === 1 || index < 0) return 'Screen';
  return `Screen ${index + 1} of ${sorted.length}${display.id === primaryId ? ' (main)' : ''}`;
}

// Screenshots of displays at native resolution: display id → { display, image }.
// Thumbnails come straight from the screen (lossless, no pointer), unlike
// video frames, which are YUV 4:2:0 and include the pointer.
async function grabDisplays(displays = screen.getAllDisplays()) {
  const grabs = new Map();
  const sizes = new Map();
  for (const d of displays) {
    const { width, height } = physical(d);
    sizes.set(`${width}x${height}`, { width, height });
  }
  // One request per size: a thumbnail is scaled to fit the requested size.
  for (const size of sizes.values()) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    for (const d of displays) {
      const source = sources.find((s) => s.display_id === String(d.id));
      const got = source?.thumbnail.getSize();
      if (got && got.width === size.width && got.height === size.height) grabs.set(d.id, { display: d, image: source.thumbnail });
    }
  }
  if (grabs.size !== displays.length) throw new Error("Couldn't capture the screen.");
  return grabs;
}

// All displays in one image, laid out as Windows arranges them.
function composeAll(grabs) {
  const scale = Math.max(...grabs.map((g) => g.display.scaleFactor));
  const left = Math.min(...grabs.map((g) => g.display.bounds.x));
  const top = Math.min(...grabs.map((g) => g.display.bounds.y));
  const place = grabs.map((g) => ({
    g, x: Math.round((g.display.bounds.x - left) * scale), y: Math.round((g.display.bounds.y - top) * scale), size: g.image.getSize(),
  }));
  const width = Math.max(...place.map((p) => p.x + p.size.width));
  const height = Math.max(...place.map((p) => p.y + p.size.height));
  const out = Buffer.alloc(width * height * 4);
  new Uint32Array(out.buffer, out.byteOffset, width * height).fill(0xff000000); // opaque black gaps
  for (const p of place) {
    const src = p.g.image.toBitmap();
    const row = p.size.width * 4;
    for (let y = 0; y < p.size.height; y++) src.copy(out, ((p.y + y) * width + p.x) * 4, y * row, y * row + row);
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

// rect: CSS px within the display → that part of its screenshot.
function cropTo(grab, rect) {
  const k = grab.display.scaleFactor;
  const size = grab.image.getSize();
  const x = Math.round(rect.x * k);
  const y = Math.round(rect.y * k);
  return grab.image.crop({
    x, y, width: Math.min(size.width - x, Math.round(rect.width * k)), height: Math.min(size.height - y, Math.round(rect.height * k)),
  });
}

module.exports = { displayAtCursor, physical, displayLabel, grabDisplays, composeAll, cropTo };
