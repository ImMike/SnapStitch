// End-to-end test: loads the real (unmodified) extension into Chrome for
// Testing, drives it through the toolbar popup exactly like a user (which is
// what grants activeTab), and verifies the captured images pixel by pixel.
//
//   cd test && npm install && npm test
//
// Runs the suite at device scale factor 1 and 1.5 (fractional scaling is where
// stitching seams show up). Captured PNGs are saved to test/artifacts/.

import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, '..');
const artifactsDir = path.join(here, 'artifacts');

const BANDS = [
  [230, 25, 75], [60, 180, 75], [255, 225, 25], [67, 99, 216], [245, 130, 49],
  [145, 30, 180], [128, 128, 0], [0, 128, 128], [170, 110, 40], [128, 0, 0],
];
const HEADER = [255, 0, 255];
const BADGE = [0, 255, 255];
const ANIM_COLORS = [[40, 180, 90], [40, 90, 200], [240, 200, 40]];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;

async function runTest(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY=record npm test
  const started = Date.now();
  try {
    await fn();
    console.log(`  ok    ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${err.stack.split('\n').slice(0, 4).join('\n        ')}`);
  }
}

function serveFixtures() {
  const server = http.createServer(async (req, res) => {
    try {
      const body = await fs.readFile(path.join(here, 'fixtures', path.basename(req.url)));
      res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function runSuite(scale, baseUrl) {
  console.log(`\nDevice scale factor ${scale}`);
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapstitch-dl-'));
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [extensionPath],
    defaultViewport: null,
    args: ['--window-size=1280,900', `--force-device-scale-factor=${scale}`],
  });

  try {
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'));
    const worker = await swTarget.worker();
    const extensionId = new URL(swTarget.url()).host;
    const extension = (await browser.extensions()).get(extensionId);
    assert.ok(extension, 'extension loaded');
    const seen = new Set();

    // Click the toolbar icon and pick a mode in the popup.
    async function clickPopup(page, mode) {
      await page.bringToFront();
      await page.triggerExtensionAction(extension);
      const target = await browser.waitForTarget(
        (t) => t.url() === `chrome-extension://${extensionId}/src/popup.html` && !seen.has(t),
        { timeout: 10000 });
      seen.add(target);
      const popup = await target.asPage();
      const button = await popup.waitForSelector(`button[data-mode="${mode}"]`);
      await button.click().catch(() => {}); // the popup closes itself mid-click
    }

    // Waits for the next preview tab and saves what it shows to artifacts/.
    async function waitForPreview(name) {
      const target = await browser.waitForTarget(
        (t) => t.url().includes(`${extensionId}/src/preview.html`) && !seen.has(t),
        { timeout: 120000 });
      seen.add(target);
      const preview = await target.asPage();
      await preview.waitForSelector('#shot:not([hidden]), #video:not([hidden])');
      const files = await preview.evaluate(async () => {
        const base64 = async (url) => {
          const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
          let s = '';
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(s);
        };
        const video = document.getElementById('video');
        const img = document.getElementById('shot');
        return video.hidden
          ? { png: await base64(img.src) }
          : { mp4: await base64(video.src), gif: await base64(img.src) };
      });
      for (const [ext, data] of Object.entries(files)) {
        await fs.writeFile(path.join(artifactsDir, `${name}@${scale}x.${ext}`), Buffer.from(data, 'base64'));
      }
      return preview;
    }

    // Resolves once a recording is running (the service worker stored it).
    async function waitForRecording() {
      await worker.evaluate(async () => {
        for (let i = 0; i < 100; i++) {
          if ((await chrome.storage.session.get('recording')).recording) return;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error('recording did not start');
      });
    }

    // Opens the popup while recording and presses Stop (or Discard).
    async function popupStop(page, button = 'stop') {
      await page.bringToFront();
      await page.triggerExtensionAction(extension);
      const target = await browser.waitForTarget(
        (t) => t.url() === `chrome-extension://${extensionId}/src/popup.html` && !seen.has(t),
        { timeout: 10000 });
      seen.add(target);
      const popup = await target.asPage();
      await (await popup.waitForSelector(`#${button}:not([hidden] *)`)).click().catch(() => {});
    }

    // Decodes a recording in the preview tab: metadata, chosen pixel rows of
    // the video at given times, and of every GIF frame.
    function inspectRecording(preview, { times = [], rows = [], gifRows = [], gifCols = [] }) {
      return preview.evaluate(async (times, rows, gifRows, gifCols) => {
        const video = document.getElementById('video');
        const videoBlob = await (await fetch(video.src)).blob();
        const gifBlob = await (await fetch(document.getElementById('shot').src)).blob();
        const ascii = async (blob, from, to) =>
          String.fromCharCode(...new Uint8Array(await blob.slice(from, to).arrayBuffer()));
        if (video.readyState < 1) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
        video.pause();
        const w = video.videoWidth;
        const h = video.videoHeight;
        const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
        const rgb = (data) => Array.from(data).filter((_, i) => i % 4 < 3);
        const rgbRow = (c, y, width) => rgb(c.getImageData(0, y, width, 1).data);
        const rgbCol = (c, x, height) => rgb(c.getImageData(x, 0, 1, height).data);
        const videoRows = [];
        for (const t of times) {
          video.currentTime = t;
          await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
          // 'seeked' can fire before the frame is decoded; drawing then gives
          // transparent pixels, so retry until the frame is really there.
          for (let i = 0; i < 40; i++) {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(video, 0, 0);
            if (ctx.getImageData(0, 0, 1, 1).data[3] === 255) break;
            await new Promise((r) => setTimeout(r, 50));
          }
          videoRows.push(rows.map((y) => rgbRow(ctx, y, w)));
        }
        const decoder = new ImageDecoder({ data: gifBlob.stream(), type: 'image/gif' });
        await decoder.completed;
        const frameCount = decoder.tracks.selectedTrack.frameCount;
        const gifFrames = [];
        let gw = 0;
        let gh = 0;
        for (let i = 0; i < frameCount; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          gw = image.displayWidth;
          gh = image.displayHeight;
          const c = new OffscreenCanvas(gw, gh).getContext('2d', { willReadFrequently: true });
          c.drawImage(image, 0, 0);
          gifFrames.push({
            duration: image.duration / 1000,
            rows: gifRows.map((y) => rgbRow(c, y, gw)),
            cols: gifCols.map((x) => rgbCol(c, x, gh)),
          });
          image.close();
        }
        return {
          type: videoBlob.type, box: await ascii(videoBlob, 4, 8), w, h, duration: video.duration,
          gifMagic: await ascii(gifBlob, 0, 6), gif: { w: gw, h: gh, frames: gifFrames }, videoRows,
          buttons: [...document.querySelectorAll('header button:not([hidden])')].map((b) => b.textContent),
        };
      }, times, rows, gifRows, gifCols);
    }

    const near = (px, color, tol) => color.every((v, i) => Math.abs(v - px[i]) <= tol);
    const pixel = (row, x) => row.slice(x * 3, x * 3 + 3);

    // Reads full rows/columns of pixels from the preview image.
    function readLines(preview, lines) {
      return preview.evaluate(async (lines) => {
        const img = document.getElementById('shot');
        await img.decode();
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const ctx = new OffscreenCanvas(w, h).getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = lines.map(({ x, y }) =>
          Array.from(x != null ? ctx.getImageData(x, 0, 1, h).data : ctx.getImageData(0, y, w, 1).data));
        return { w, h, data };
      }, lines);
    }

    // Compares a line of pixels with expectedAt(cssPos), where null means
    // "don't check". Pixels within 2 device px of a color boundary are
    // skipped (edge antialiasing).
    function checkLine(pixels, k, expectedAt, label) {
      const n = pixels.length / 4;
      let bad = 0;
      let firstBad = null;
      for (let i = 0; i < n; i++) {
        const want = expectedAt((i + 0.5) / k);
        if (!want || expectedAt((i - 2) / k) !== want || expectedAt((i + 3) / k) !== want) continue;
        const got = pixels.slice(i * 4, i * 4 + 4);
        const ok = got[3] === 255 && want.every((v, c) => Math.abs(v - got[c]) <= 2);
        if (!ok) {
          bad++;
          firstBad ??= `px ${i}: got rgba(${got}) want rgb(${want})`;
        }
      }
      assert.equal(bad, 0, `${label}: ${bad} wrong pixels, first at ${firstBad}`);
    }

    const page = await browser.newPage();
    await page.goto(`${baseUrl}/long-page.html`);

    // Runs a test, then closes every tab and recording it left behind (even on
    // failure) so one failure can't cascade into the next test.
    const test = (name, fn) => runTest(name, async () => {
      try {
        await fn();
      } finally {
        await worker.evaluate(async () => {
          await chrome.offscreen.closeDocument().catch(() => {});
          await chrome.storage.session.remove('recording');
        });
        for (const p of await browser.pages()) {
          if (p.target() !== page.target()) await p.close().catch(() => {});
        }
      }
    });
    const hasOverlay = () =>
      [...document.documentElement.children].some((el) => el.style.zIndex === '2147483647');
    const waitOpts = { polling: 100, timeout: 10000 };
    const metrics = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      innerWidth, innerHeight,
      viewW: document.documentElement.clientWidth,
      viewH: document.documentElement.clientHeight,
    }));
    console.log(`  viewport ${metrics.viewW}x${metrics.viewH} css, dpr ${metrics.dpr}`);

    await test('popup lists shortcuts', async () => {
      const popup = await browser.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
      const keys = await popup.$$eval('kbd', (els) => els.map((e) => e.textContent));
      // Screenshot x3, record area, record visible (no default), Stop hint.
      assert.deepEqual(keys, ['Alt+Shift+S', 'Alt+Shift+V', 'Alt+Shift+F', 'Alt+Shift+G', '', 'Alt+Shift+G']);
      await popup.close();
    });

    await test('visible capture', async () => {
      await clickPopup(page, 'visible');
      const preview = await waitForPreview('visible');
      const { w, h } = await readLines(preview, []);
      assert.ok(Math.abs(w - metrics.innerWidth * metrics.dpr) <= 1, `width ${w}`);
      assert.ok(Math.abs(h - metrics.innerHeight * metrics.dpr) <= 1, `height ${h}`);
      await preview.close();
    });

    await test('full page: sticky header once, fixed badge once, seamless bands', async () => {
      await page.evaluate(() => window.scrollTo(0, 1234));
      await clickPopup(page, 'full');
      const preview = await waitForPreview('full-long');
      const badgeX = metrics.viewW - 80;
      const { w, h, data } = await readLines(preview, [
        { x: Math.round(10 * metrics.dpr) },
        { x: Math.round(badgeX * metrics.dpr) },
        { x: Math.round(215 * metrics.dpr) },
      ]);
      const k = w / metrics.viewW;
      assert.ok(Math.abs(k - metrics.dpr) < 0.01, `scale ${k}`);
      assert.equal(h, Math.round(6060 * k), 'stitched height');
      const pageColor = (y) => (y < 60 ? HEADER : BANDS[Math.min(9, Math.floor((y - 60) / 600))]);
      checkLine(data[0], k, pageColor, 'left column');
      const badgeTop = metrics.viewH - 60;
      checkLine(data[1], k, (y) => (y >= badgeTop && y < badgeTop + 40 ? BADGE : pageColor(y)), 'badge column');
      // Ruler: every device row must appear exactly once, in order.
      const ruler = data[2];
      for (let i = 0; i < h; i++) {
        const [r, g, b] = ruler.slice(i * 4, i * 4 + 3);
        assert.ok(b === 77 && r + 256 * g === i, `ruler row ${i} reads ${r + 256 * g} (rgb ${r},${g},${b})`);
      }
      const restored = await page.evaluate(() => ({
        y: scrollY,
        header: getComputedStyle(document.querySelector('header')).position,
        badge: getComputedStyle(document.getElementById('badge')).visibility,
      }));
      assert.deepEqual(restored, { y: 1234, header: 'sticky', badge: 'visible' }, 'page restored');
    });

    await test('full page: 2D tiling on wide page', async () => {
      const wide = await browser.newPage();
      await wide.goto(`${baseUrl}/wide-page.html`);
      const view = await wide.evaluate(() => document.documentElement.clientWidth);
      await clickPopup(wide, 'full');
      const preview = await waitForPreview('full-wide');
      const k = metrics.dpr;
      const lines = [250, 750, 1250, 1750].map((y) => ({ y: Math.round(y * k) }))
        .concat([250, 1250, 2250].map((x) => ({ x: Math.round(x * k) })));
      const { w, h, data } = await readLines(preview, lines);
      assert.equal(w, Math.round(2500 * k), 'width');
      assert.equal(h, Math.round(2000 * k), 'height');
      const cell = (x, y) => [30 + 45 * Math.min(4, Math.floor(x / 500)), 30 + 60 * Math.min(3, Math.floor(y / 500)), 128];
      [250, 750, 1250, 1750].forEach((y, i) => checkLine(data[i], k, (x) => cell(x, y), `row y=${y}`));
      [250, 1250, 2250].forEach((x, i) => checkLine(data[4 + i], k, (y) => cell(x, y), `column x=${x}`));
      await preview.close();
      await wide.close();
      assert.ok(view < 2500, 'page overflowed horizontally');
    });

    await test('region: drag selection, overlay not captured, auto-copied', async () => {
      await page.evaluate(() => window.scrollTo(0, 2000));
      await clickPopup(page, 'region');
      await page.waitForFunction(hasOverlay, waitOpts);
      await page.mouse.move(100, 150);
      await page.mouse.down();
      await page.mouse.move(250, 250, { steps: 5 });
      await page.mouse.move(400, 350, { steps: 5 });
      await page.mouse.up();
      const preview = await waitForPreview('region');
      const k = metrics.dpr;
      const { w, h, data } = await readLines(preview, [
        { x: 0 }, { x: Math.round(150 * k) }, { y: 0 }, { x: Math.round(115 * k) },
      ]);
      assert.equal(w, Math.round(300 * k), 'width');
      assert.equal(h, Math.round(200 * k), 'height');
      // Page y 2150..2350 is entirely band 3 (apart from the ruler at page
      // x 200..230); any overlay tint would fail this.
      checkLine(data[0], k, () => BANDS[3], 'left edge');
      checkLine(data[1], k, () => BANDS[3], 'middle column');
      checkLine(data[2], k, (x) => (x >= 100 && x < 130 ? null : BANDS[3]), 'top row');
      // Ruler column pins the crop to the exact device row.
      const top = Math.round(2000 * k) + Math.round(150 * k);
      for (let i = 0; i < h; i++) {
        const [r, g, b] = data[3].slice(i * 4, i * 4 + 3);
        assert.ok(b === 77 && r + 256 * g === top + i, `region row ${i} reads ruler ${r + 256 * g}, want ${top + i}`);
      }
      const toast = await preview.waitForFunction(
        () => document.getElementById('toast').textContent, waitOpts);
      assert.equal(await toast.jsonValue(), 'Copied to clipboard');
      assert.ok(!(await page.evaluate(hasOverlay)), 'overlay removed');
    });

    await test('region: Esc cancels without capturing', async () => {
      await clickPopup(page, 'region');
      await page.waitForFunction(hasOverlay, waitOpts);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() =>
        ![...document.documentElement.children].some((el) => el.style.zIndex === '2147483647'), waitOpts);
      await new Promise((r) => setTimeout(r, 1000));
      const previews = browser.targets().filter((t) => t.url().includes('/src/preview.html') && !seen.has(t));
      assert.equal(previews.length, 0, 'no capture after Esc');
    });

    await test('preview: download saves PNG', async () => {
      await clickPopup(page, 'visible');
      const preview = await waitForPreview('download');
      const cdp = await preview.createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
      await preview.click('#download');
      let file;
      for (let i = 0; i < 50 && !file; i++) {
        await new Promise((r) => setTimeout(r, 100));
        file = (await fs.readdir(downloadDir)).find((f) => f.endsWith('.png'));
      }
      assert.ok(file, 'downloaded file');
      assert.match(file, /^screenshot_127\.0\.0\.1_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/);
      const bytes = await fs.readFile(path.join(downloadDir, file));
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      await preview.close();
    });

    await test('preview: Delete removes the capture and closes the tab', async () => {
      await clickPopup(page, 'visible');
      const preview = await waitForPreview('delete');
      const id = new URL(preview.url()).searchParams.get('id');
      const closed = new Promise((resolve) => preview.once('close', resolve));
      await preview.click('#delete');
      await Promise.race([closed, sleep(5000).then(() => assert.fail('preview tab not closed'))]);
      const check = await browser.newPage();
      await check.goto(`chrome-extension://${extensionId}/src/preview.html?id=${id}`);
      await check.waitForFunction(() => document.getElementById('title').textContent === 'Capture not found', waitOpts);
      assert.equal(await check.$eval('#delete', (b) => b.hidden), true, 'no Delete on a missing capture');
    });

    await test('desktop capture: imported over native messaging, opens like any capture', async () => {
      // A scripted stand-in for the native port (desktop/host/host.js protocol).
      const host = await browser.newPage();
      await host.goto(`chrome-extension://${extensionId}/src/preview.html?id=none`);
      const run = (scenario) => host.evaluate(async (scenario) => {
        const { importDesktopShot } = await import('./desktop-import.js');
        const { getShot } = await import('./db.js');
        const canvas = new OffscreenCanvas(300, 200);
        const c = canvas.getContext('2d');
        c.fillStyle = 'rgb(230, 25, 75)';
        c.fillRect(0, 0, 300, 200);
        const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        const video = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251); // exercises the credit window
        const b64 = (bytes) => {
          let s = '';
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(s);
        };
        const id = crypto.randomUUID();
        const sent = [];
        const on = { msg: [], disc: [] };
        const emit = (m) => on.msg.forEach((f) => f(m));
        const port = {
          onMessage: { addListener: (f) => on.msg.push(f) },
          onDisconnect: { addListener: (f) => on.disc.push(f) },
          disconnect: () => sent.push({ type: 'disconnect' }),
          postMessage(m) {
            sent.push(m.type === 'more' ? { type: 'more', received: m.received } : m);
            if (m.type !== 'get') return;
            setTimeout(() => {
              if (scenario === 'drop') return on.disc.forEach((f) => f());
              if (scenario === 'error') return emit({ type: 'error', code: 'not-found', message: 'gone' });
              emit({ type: 'waiting' });
              const big = scenario === 'video';
              const parts = big
                ? [{ field: 'video', type: 'video/mp4', size: video.length }, { field: 'gif', type: 'image/gif', size: png.length }]
                : [{ field: 'blob', type: 'image/png', size: png.length + (scenario === 'short' ? 1 : 0) }];
              const shot = big
                ? { mode: 'record-screen', kind: 'video', title: 'Desktop', display: 'Screen 2 of 3', width: 300, height: 200, duration: 3, createdAt: Date.now() }
                : { mode: 'screen', title: 'Desktop', display: 'Screen 2 of 3', width: 300, height: 200, createdAt: Date.now() };
              emit({ type: 'meta', shot, parts });
              const send = (field, bytes) => {
                for (let i = 0; i < bytes.length; i += 512 * 1024) emit({ type: 'chunk', field, data: b64(bytes.subarray(i, i + 512 * 1024)) });
              };
              if (big) {
                send('video', video);
                send('gif', png);
              } else {
                send('blob', png);
              }
              emit({ type: 'end' });
            }, 10);
          },
        };
        let waited = false;
        try {
          const shot = await importDesktopShot(id, { connect: () => port, onWaiting: () => (waited = true) });
          const stored = await getShot(id);
          return { id, waited, sent, stored: !!stored, source: stored.source, size: (stored.blob ?? stored.video).size };
        } catch (err) {
          return { id, error: err.message, sent, stored: !!(await getShot(id)) };
        }
      }, scenario);

      const png = await run('png');
      assert.equal(png.error, undefined);
      assert.ok(png.stored && png.waited && png.source === 'desktop', JSON.stringify(png));
      assert.deepEqual(png.sent.map((m) => m.type), ['get', 'ack']);

      const vid = await run('video');
      assert.equal(vid.size, 9 * 1024 * 1024, 'video bytes intact');
      assert.deepEqual(vid.sent.filter((m) => m.type === 'more').map((m) => m.received), [4 * 1024 * 1024, 8 * 1024 * 1024]);
      assert.equal(vid.sent.at(-1).type, 'ack');

      for (const [scenario, message] of [['short', /incomplete/], ['error', /^gone$/], ['drop', /Lost the connection/]]) {
        const r = await run(scenario);
        assert.match(r.error ?? '', message, scenario);
        assert.equal(r.stored, false, `${scenario}: nothing stored`);
        assert.ok(!r.sent.some((m) => m.type === 'ack'), `${scenario}: no ack`);
      }

      // The stored capture opens like any other, labeled as a desktop capture.
      const preview = await browser.newPage();
      await preview.goto(`chrome-extension://${extensionId}/src/preview.html?id=${png.id}`);
      await preview.waitForSelector('#shot:not([hidden])');
      const header = await preview.evaluate(() => ({
        title: document.getElementById('title').textContent,
        meta: document.getElementById('meta').textContent,
        buttons: [...document.querySelectorAll('.actions > button:not([hidden])')].map((b) => b.textContent),
      }));
      assert.deepEqual(header, {
        title: 'Desktop', meta: 'Full screen · Screen 2 of 3 · 300 × 200 px', buttons: ['Delete', 'Copy', 'Download PNG'],
      });
      const cdp = await preview.createCDPSession();
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
      await preview.click('#download');
      let file;
      for (let i = 0; i < 50 && !file; i++) {
        await sleep(100);
        file = (await fs.readdir(downloadDir)).find((f) => f.startsWith('screenshot_desktop_'));
      }
      assert.match(file ?? '', /^screenshot_desktop_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/);
    });

    await test('restricted page shows error badge, next capture still works', async () => {
      const internal = await browser.newPage();
      await internal.goto('chrome://version');
      await clickPopup(internal, 'full');
      await worker.evaluate(async () => {
        for (let i = 0; i < 50 && (await chrome.action.getBadgeText({})) !== '!'; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '!');
      await internal.close();
      await clickPopup(page, 'visible');
      await (await waitForPreview('after-error')).close();
    });

    // --- Recording ---------------------------------------------------------
    const devW = Math.round(metrics.innerWidth * metrics.dpr) & ~1;
    const devH = Math.round(metrics.innerHeight * metrics.dpr) & ~1;
    const gifScale = Math.min(800, devW) / devW; // GIF px per video px
    const matchAnim = (px, tol) => ANIM_COLORS.findIndex((c) => near(px, c, tol));

    await test('record visible page: MP4 + GIF, colors and length right', async () => {
      const anim = await browser.newPage();
      await anim.goto(`${baseUrl}/anim-page.html`);
      await clickPopup(anim, 'record-visible');
      await waitForRecording();
      await sleep(2600);
      await popupStop(anim);
      const preview = await waitForPreview('record-visible');
      const times = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25];
      const rec = await inspectRecording(preview, {
        times, rows: [devH >> 1], gifRows: [Math.round((devH >> 1) * gifScale)],
      });
      assert.equal(rec.type, 'video/mp4');
      assert.equal(rec.box, 'ftyp');
      assert.ok(Math.abs(rec.w - devW) <= 2 && rec.w % 2 === 0, `video width ${rec.w}`);
      assert.ok(Math.abs(rec.h - devH) <= 2 && rec.h % 2 === 0, `video height ${rec.h}`);
      assert.ok(rec.duration > 2.4 && rec.duration < 5, `duration ${rec.duration}`);
      const seen = new Set();
      rec.videoRows.forEach(([row], i) => {
        const px = pixel(row, rec.w >> 1);
        const c = matchAnim(px, 24);
        assert.ok(c >= 0, `video at ${times[i]}s: rgb(${px}) is not a fixture color`);
        seen.add(c);
      });
      assert.ok(seen.size >= 2, 'video shows the animation');

      assert.equal(rec.gifMagic, 'GIF89a');
      assert.equal(rec.gif.w, Math.min(800, rec.w));
      assert.ok(rec.gif.frames.length >= 3, `${rec.gif.frames.length} GIF frames`);
      const gifSeen = new Set(rec.gif.frames.map(({ rows: [row] }) => {
        const px = pixel(row, rec.gif.w >> 1);
        const c = matchAnim(px, 12);
        assert.ok(c >= 0, `GIF rgb(${px}) is not a fixture color`);
        return c;
      }));
      assert.ok(gifSeen.size >= 2, 'GIF shows the animation');
      const gifLength = rec.gif.frames.reduce((s, f) => s + f.duration, 0) / 1000;
      assert.ok(Math.abs(gifLength - rec.duration) < 0.2, `GIF ${gifLength}s vs video ${rec.duration}s`);
      assert.deepEqual(rec.buttons.slice(-2), ['Download GIF', 'Download MP4']);
    });

    await test('record area: exact crop, outline + Stop bar not recorded, cursor and click drawn', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await clickPopup(page, 'record-area');
      await page.waitForFunction(hasOverlay, waitOpts);
      // Area over band 1 (green), page x 600..1000, y 680..780; no room below,
      // so the Stop bar goes above it. Far right/bottom on purpose: with an
      // odd viewport height Chrome scales capture frames slightly, which
      // shifts content most there (see docs/chrome-notes.md).
      await page.mouse.move(600, 680);
      await page.mouse.down();
      await page.mouse.move(1000, 780, { steps: 5 });
      await page.mouse.up();
      await waitForRecording();
      await page.waitForSelector('>>> .bar', waitOpts);
      await page.mouse.move(800, 730); // one step, so the drawn cursor never touches the edges
      await sleep(300);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(1500);
      await page.click('>>> .stop');
      const preview = await waitForPreview('record-area');
      const k = metrics.dpr;
      const vw = Math.round(400 * k) & ~1;
      const vh = Math.round(100 * k) & ~1;
      const tipX = Math.round(200 * k);
      const armRow = Math.round(58 * k); // 8 css px below the cursor tip
      const clickRow = Math.round(50 * k);
      const rec = await inspectRecording(preview, {
        times: [1.4], rows: [0, armRow, vh - 1], gifRows: [0, clickRow, armRow, vh - 1], gifCols: [0, vw - 1],
      });
      assert.equal(rec.w, vw, 'width');
      assert.equal(rec.h, vh, 'height');
      const GREEN = BANDS[1];
      // Edges are band color: the dashed outline sits outside the area.
      const [[top, arm, bottom]] = rec.videoRows;
      for (const [label, px] of [['top-left', pixel(top, 0)], ['top-right', pixel(top, vw - 1)],
        ['bottom-mid', pixel(bottom, vw >> 1)], ['left-mid', pixel(arm, 0)], ['right-mid', pixel(arm, vw - 1)]]) {
        assert.ok(near(px, GREEN, 30), `${label} edge rgb(${px}) should be page content`);
      }
      // Cursor arrow is white just right of its tip.
      const white = (row, from, to) => [...Array(to - from).keys()].some((i) => pixel(row, from + i).every((v) => v > 200));
      assert.ok(white(arm, tipX, tipX + Math.round(6 * k)), 'cursor drawn in video');
      assert.ok(rec.gif.frames.some(({ rows }) => white(rows[2], tipX, tipX + Math.round(6 * k))), 'cursor drawn in GIF');
      // Click ripple: an indigo ring around the click point in some GIF frame.
      const indigo = (px) => px[2] > 150 && px[1] < 150 && px[0] < 150;
      assert.ok(rec.gif.frames.some(({ rows }) => [...Array(vw).keys()].some((x) => indigo(pixel(rows[1], x)))),
        'click ripple drawn');
      // GIF pixels are exact copies of the capture, so every edge pixel of
      // every frame must be band color: even a faint blend of the red outline
      // fails this.
      rec.gif.frames.forEach(({ rows: [gifTop, , , gifBottom], cols: [gifLeft, gifRight] }, f) => {
        for (const [label, line] of [['top', gifTop], ['bottom', gifBottom], ['left', gifLeft], ['right', gifRight]]) {
          const bad = [...Array(line.length / 3).keys()].find((i) => !near(pixel(line, i), GREEN, 12));
          assert.equal(bad, undefined, `GIF frame ${f} ${label} edge px ${bad}: rgb(${bad === undefined ? '' : pixel(line, bad)})`);
        }
      });
      assert.ok(!(await page.evaluate(() => [...document.documentElement.children]
        .some((el) => el.shadowRoot?.querySelector('.bar')))), 'Stop bar removed after stopping');
    });

    await test('cursor follows the mouse on a static page', async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(200, 400);
      await clickPopup(page, 'record-visible');
      await waitForRecording();
      await sleep(300);
      for (let x = 200; x <= 900; x += 50) {
        await page.mouse.move(x, 400);
        await sleep(120);
      }
      await sleep(300);
      await popupStop(page);
      const preview = await waitForPreview('record-cursor');
      const gifK = metrics.dpr * gifScale; // GIF px per CSS px
      const rec = await inspectRecording(preview, { gifRows: [Math.round(408 * gifK)] });
      const positions = new Set();
      for (const { rows: [row] } of rec.gif.frames) {
        const x = [...Array(rec.gif.w).keys()].find((i) => pixel(row, i).every((v) => v > 215));
        if (x !== undefined) positions.add(Math.round(x / gifK / 50) * 50);
      }
      assert.ok(positions.size >= 3, `cursor seen at ${[...positions]} css px`);
    });

    await test('discard from popup saves nothing', async () => {
      await clickPopup(page, 'record-visible');
      await waitForRecording();
      await sleep(800);
      await popupStop(page, 'discard');
      const state = await worker.evaluate(async () => {
        for (let i = 0; i < 50; i++) {
          if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        return {
          recorders: (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length,
          stored: (await chrome.storage.session.get('recording')).recording ?? null,
          badge: await chrome.action.getBadgeText({}),
        };
      });
      assert.deepEqual(state, { recorders: 0, stored: null, badge: '' });
      await sleep(1000);
      const previews = browser.targets().filter((t) => t.url().includes('/src/preview.html') && !seen.has(t));
      assert.equal(previews.length, 0, 'no preview opened');
    });

    await test('closing the recorded tab saves the recording', async () => {
      const anim = await browser.newPage();
      await anim.goto(`${baseUrl}/anim-page.html`);
      await clickPopup(anim, 'record-visible');
      await waitForRecording();
      await sleep(1500);
      await anim.close();
      const preview = await waitForPreview('record-tab-closed');
      const rec = await inspectRecording(preview, {});
      assert.ok(rec.duration > 1.2 && rec.duration < 4, `duration ${rec.duration}`);
    });
  } finally {
    await browser.close();
    await fs.rm(downloadDir, { recursive: true, force: true });
  }
}

await fs.mkdir(artifactsDir, { recursive: true });
const server = await serveFixtures();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
try {
  for (const scale of [1, 1.5]) await runSuite(scale, baseUrl);
} finally {
  server.close();
}
console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exitCode = failures ? 1 : 0;
