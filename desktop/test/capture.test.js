// Pixel checks for capture.js on synthetic screens. Runs in Electron (for
// nativeImage), opens no windows: npm run test:capture
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { composeAll, cropTo, displayLabel } = require('../capture.js');

// Every pixel unique: BGRA from (x, y, seed).
function synthetic(width, height, seed) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) buf.writeUInt32LE(((0xff << 24) | ((seed & 0xff) << 16) | ((y & 0xff) << 8) | (x & 0xff)) >>> 0, (y * width + x) * 4);
  }
  return nativeImage.createFromBitmap(buf, { width, height });
}
const px = (image, x, y) => image.toBitmap().readUInt32LE((y * image.getSize().width + x) * 4);
const display = (id, x, y, w, h, scaleFactor = 1) => ({ id, bounds: { x, y, width: w, height: h }, scaleFactor });

const tests = {
  'crop copies the selected pixels exactly (100%)'() {
    const image = synthetic(200, 120, 1);
    const out = cropTo({ display: display(1, 0, 0, 200, 120), image }, { x: 10.4, y: 20, width: 50, height: 30 });
    assert.deepEqual(out.getSize(), { width: 50, height: 30 });
    for (const [x, y] of [[0, 0], [49, 29], [17, 3]]) assert.equal(px(out, x, y), px(image, 10 + x, 20 + y));
  },
  'crop maps CSS px to device px at 150% and stays inside the screen'() {
    const image = synthetic(300, 180, 2); // a 200×120 CSS px display
    const out = cropTo({ display: display(1, 0, 0, 200, 120, 1.5), image }, { x: 180, y: 100, width: 40, height: 40 });
    assert.deepEqual(out.getSize(), { width: 30, height: 30 }); // clipped at the right/bottom edge
    assert.equal(px(out, 0, 0), px(image, 270, 150));
    assert.equal(px(out, 29, 29), px(image, 299, 179));
  },
  'PNG keeps every pixel'() {
    const image = synthetic(64, 48, 3);
    assert.ok(nativeImage.createFromBuffer(image.toPNG()).toBitmap().equals(image.toBitmap()));
  },
  'all screens: laid out like Windows, gaps black'() {
    const grabs = [
      { display: display(1, -64, 0, 64, 32), image: synthetic(64, 32, 10) },
      { display: display(2, 0, 0, 64, 32), image: synthetic(64, 32, 20) },
      { display: display(3, 64, 8, 64, 32), image: synthetic(64, 32, 30) }, // lower by 8 px
    ];
    const out = composeAll(grabs);
    assert.deepEqual(out.getSize(), { width: 192, height: 40 });
    assert.equal(px(out, 0, 0), px(grabs[0].image, 0, 0));
    assert.equal(px(out, 64 + 63, 31), px(grabs[1].image, 63, 31));
    assert.equal(px(out, 128, 8), px(grabs[2].image, 0, 0));
    assert.equal(px(out, 128 + 5, 39), px(grabs[2].image, 5, 31));
    assert.equal(px(out, 130, 2), 0xff000000, 'gap is opaque black');
    assert.equal(px(out, 10, 35), 0xff000000);
  },
  'screen labels count left to right'() {
    const all = [display(7, 0, 0, 10, 10), display(5, -10, 0, 10, 10), display(9, 10, 0, 10, 10)];
    assert.equal(displayLabel(all[0], all, 7), 'Screen 2 of 3 (main)');
    assert.equal(displayLabel(all[1], all, 7), 'Screen 1 of 3');
    assert.equal(displayLabel(all[0], [all[0]], 7), 'Screen');
  },
};

app.whenReady().then(() => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try {
      fn();
      console.log(`  ok    ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${name}\n        ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} failed` : '\nAll capture tests passed');
  app.exit(failed ? 1 : 0);
});
