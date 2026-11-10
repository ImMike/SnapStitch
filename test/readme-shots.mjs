// Regenerates the README images in docs/images/ and the Chrome Web Store
// images in docs/store/ by driving the real extension
// on a fictional demo page (fixtures/demo-page.html).
//
//   cd test && npm install && npm run shots

import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'docs', 'images');
const storeOut = path.join(root, 'docs', 'store');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The demo page is served at a reserved .example domain (never a real site)
// so screenshots show a normal-looking address instead of localhost.
const demoUrl = 'https://trailnotes.example/weekend-on-the-ridge';
const demoHtml = await fs.readFile(path.join(here, 'fixtures', 'demo-page.html'));
await fs.mkdir(out, { recursive: true });
await fs.mkdir(storeOut, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  enableExtensions: [root],
  defaultViewport: null,
  args: ['--window-size=1280,860', '--force-device-scale-factor=1', '--hide-scrollbars'],
});

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'));
  const id = new URL(sw.url()).host;
  const extension = (await browser.extensions()).get(id);
  const seen = new Set();
  const light = (p) => p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  const dataUrl = (buf, type = 'image/png') => `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
  const hasOverlay = () => [...document.documentElement.children].some((el) => el.style.zIndex === '2147483647');

  async function clickPopup(page, mode) {
    await page.bringToFront();
    await page.triggerExtensionAction(extension);
    const target = await browser.waitForTarget(
      (t) => t.url().endsWith('/src/popup.html') && !seen.has(t), { timeout: 10000 });
    seen.add(target);
    const popup = await target.asPage();
    await (await popup.waitForSelector(`button[data-mode="${mode}"]`)).click().catch(() => {});
  }

  async function nextPreview() {
    const target = await browser.waitForTarget(
      (t) => t.url().includes('/src/preview.html') && !seen.has(t), { timeout: 120000 });
    seen.add(target);
    const preview = await target.asPage();
    await light(preview);
    await preview.waitForSelector('#shot:not([hidden]), #video:not([hidden])');
    return preview;
  }

  const fetchBytes = (preview, selector) => preview.evaluate(async (sel) => {
    const bytes = new Uint8Array(await (await fetch(document.querySelector(sel).src)).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, selector).then((b64) => Buffer.from(b64, 'base64'));

  // Renders an HTML composition to docs/images/<file>. height 'auto' fits the content.
  async function render(html, width, height, file, deviceScaleFactor = 1, dir = out) {
    const p = await browser.newPage();
    await p.setViewport({ width, height: height === 'auto' ? 100 : height, deviceScaleFactor });
    await p.setContent(html, { waitUntil: 'load' });
    if (height === 'auto') {
      const h = await p.evaluate(async () => {
        await Promise.all([...document.images].map((img) => img.decode()));
        return document.documentElement.scrollHeight;
      });
      await p.setViewport({ width, height: h, deviceScaleFactor });
    }
    await p.screenshot({ path: path.join(dir, file) });
    await p.close();
  }

  const center = (page, selector) => page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
  });

  // --- Popup, light and dark -------------------------------------------------
  const popupShot = async (scheme) => {
    const p = await browser.newPage();
    await p.setViewport({ width: 262, height: 400, deviceScaleFactor: 2 });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await p.goto(`chrome-extension://${id}/src/popup.html`);
    const height = await p.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    const shot = await p.screenshot({ clip: { x: 0, y: 0, width: 262, height } });
    await p.close();
    return { src: dataUrl(shot), height };
  };
  const popupLight = await popupShot('light');
  const popupDark = await popupShot('dark');
  await render(`
    <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;gap:40px;
      background:linear-gradient(135deg,#eef2ff,#e0f2fe 60%,#1f2937 60%)">
      <img src="${popupLight.src}" width="262" style="border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.18)">
      <img src="${popupDark.src}" width="262" style="border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45)">
    </body>`, 680, popupLight.height + 80, 'popup.png', 2);

  // --- Area screenshot ---------------------------------------------------------
  const page = await browser.newPage();
  await light(page);
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.url() === demoUrl
    ? req.respond({ status: 200, contentType: 'text/html', body: demoHtml })
    : req.continue()));
  await page.goto(demoUrl);
  await page.evaluate(() => window.scrollTo(0, 300));
  await clickPopup(page, 'region');
  await page.waitForFunction(hasOverlay, { polling: 100 });
  await page.mouse.move(130, 130);
  await page.mouse.down();
  await page.mouse.move(800, 520, { steps: 8 });
  const areaSelect = await page.screenshot({ path: path.join(out, 'area-select.png') });
  await page.mouse.up();
  let preview = await nextPreview();
  await preview.waitForFunction(() => document.getElementById('toast').classList.contains('show'), { polling: 100 });
  const previewShot = await preview.screenshot({ path: path.join(out, 'preview-screenshot.png') });
  await preview.close();

  // --- Whole page ----------------------------------------------------------------
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  const onScreen = await page.screenshot();
  await clickPopup(page, 'full');
  preview = await nextPreview();
  const stitched = await fetchBytes(preview, '#shot');
  await preview.close();
  await render(`
    <body style="margin:0;box-sizing:border-box;padding:36px 48px 60px;font-family:system-ui;
      background:linear-gradient(135deg,#eef2ff,#e0f2fe);color:#1f2937;display:flex;gap:44px;align-items:flex-start">
      <div style="flex:1">
        <div style="font-size:15px;font-weight:600;color:#6b7280;margin-bottom:10px">WHAT'S ON YOUR SCREEN</div>
        <img src="${dataUrl(onScreen)}" style="width:100%;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.15)">
        <div style="margin-top:34px;font-size:40px;font-weight:700;line-height:1.15">One shortcut.<br>The whole page.</div>
        <div style="margin-top:14px;font-size:19px;color:#4b5563;line-height:1.5">
          SnapStitch scrolls the page for you and stitches every part into one sharp PNG.
          Sticky headers and pop-up widgets show up once, not on every tile.</div>
        <div style="margin-top:22px;display:inline-block;padding:9px 16px;border-radius:8px;background:#4f46e5;
          color:#fff;font:600 16px ui-monospace,Consolas,monospace">Alt + Shift + F</div>
      </div>
      <div style="width:380px">
        <div style="font-size:15px;font-weight:600;color:#6b7280;margin-bottom:10px">WHAT SNAPSTITCH SAVES</div>
        <img src="${dataUrl(stitched)}" style="width:100%;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.15)">
      </div>
    </body>`, 1280, 'auto', 'full-page.png');

  // --- Area recording ----------------------------------------------------------------
  await page.evaluate(() => window.scrollTo(0, 380));
  await sleep(200);
  await page.mouse.move(400, 300);
  await clickPopup(page, 'record-area');
  await page.waitForFunction(hasOverlay, { polling: 100 });
  await page.mouse.move(100, 110);
  await page.mouse.down();
  await page.mouse.move(820, 515, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('>>> .bar', { polling: 100 });
  await sleep(500);
  await page.mouse.move(...(await center(page, '#save')), { steps: 25 });
  await sleep(400);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(700);
  await page.mouse.move(...(await center(page, '.card:nth-child(2)')), { steps: 25 });
  await sleep(900);
  const recordingShot = await page.screenshot({ path: path.join(out, 'recording.png') });
  await page.evaluate(() => window.scrollBy({ top: 240, behavior: 'smooth' }));
  await sleep(900);
  await page.mouse.move(...(await center(page, '.card:nth-child(3)')), { steps: 20 });
  await sleep(700);
  await page.mouse.move(...(await center(page, '.chart div:nth-child(5)')), { steps: 20 });
  await sleep(1000);
  await page.click('>>> .stop');
  preview = await nextPreview();
  await fs.writeFile(path.join(out, 'demo.gif'), await fetchBytes(preview, '#shot'));
  await preview.evaluate(async () => {
    const video = document.getElementById('video');
    video.pause();
    video.currentTime = 3;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
  });
  await sleep(1200); // let the player's loading spinner clear
  const previewRecording = await preview.screenshot({ path: path.join(out, 'preview-recording.png') });
  await preview.close();

  // --- Hero / social preview (1280x640) ------------------------------------------
  const icon = dataUrl(await fs.readFile(path.join(root, 'icons', '128.png')));
  const chip = (t) => `<span style="padding:7px 13px;border-radius:999px;background:#fff;border:1px solid #c7d2fe;
    color:#3730a3;font-size:16px;font-weight:600">${t}</span>`;
  await render(`
    <body style="margin:0;height:100vh;overflow:hidden;font-family:system-ui;color:#111827;
      background:radial-gradient(circle at 85% 20%,#c7d2fe,transparent 45%),linear-gradient(135deg,#eef2ff,#e0f2fe);">
      <div style="position:absolute;left:64px;top:84px;width:470px">
        <div style="display:flex;align-items:center;gap:18px">
          <img src="${icon}" width="76" height="76">
          <div style="font-size:64px;font-weight:800;letter-spacing:-1.5px">SnapStitch</div>
        </div>
        <div style="margin-top:22px;font-size:34px;font-weight:700;line-height:1.2">
          The free Gyazo alternative that keeps everything on your PC.</div>
        <div style="margin-top:16px;font-size:20px;color:#4b5563;line-height:1.45">
          Screenshot any area, the visible page or the whole scrolling page.
          Record your tab as MP4 or GIF. No account, no uploads.</div>
        <div style="margin-top:26px;display:flex;flex-wrap:wrap;gap:10px">
          ${['Area', 'Full page', 'MP4', 'GIF', '100% local', 'Open source'].map(chip).join('')}
        </div>
      </div>
      <div style="position:absolute;left:640px;top:70px;width:700px;border-radius:12px;overflow:hidden;
        background:#fff;box-shadow:0 24px 60px rgba(30,27,75,.25)">
        <div style="height:30px;background:#e5e7eb;display:flex;align-items:center;gap:7px;padding-left:12px">
          <i style="width:11px;height:11px;border-radius:50%;background:#f87171"></i>
          <i style="width:11px;height:11px;border-radius:50%;background:#fbbf24"></i>
          <i style="width:11px;height:11px;border-radius:50%;background:#34d399"></i>
        </div>
        <img src="${dataUrl(areaSelect)}" style="display:block;width:100%">
      </div>
      <img src="${popupLight.src}" width="230" style="position:absolute;left:566px;top:300px;border-radius:10px;
        box-shadow:0 18px 50px rgba(0,0,0,.28)">
    </body>`, 1280, 640, 'hero.png');

  // --- Chrome Web Store: 1280x800 screenshots and the promo tiles -----------
  // Store listings may not lean on other products' names, so none appear here.
  const shot = (src, width, extra = '') => `<img src="${dataUrl(src)}" width="${width}"
    style="display:block;border-radius:10px;box-shadow:0 14px 40px rgba(30,27,75,.22);${extra}">`;
  const storeShot = (file, kicker, headline, sub, visual) => render(`
    <body style="margin:0;height:100vh;overflow:hidden;box-sizing:border-box;padding-top:46px;font-family:system-ui;
      color:#111827;text-align:center;background:radial-gradient(circle at 85% 10%,#c7d2fe,transparent 40%),
      linear-gradient(135deg,#eef2ff,#e0f2fe)">
      <div style="font-size:15px;font-weight:700;letter-spacing:.08em;color:#4f46e5">${kicker}</div>
      <div style="margin-top:10px;font-size:42px;font-weight:800;letter-spacing:-.8px">${headline}</div>
      <div style="margin-top:10px;font-size:20px;color:#4b5563">${sub}</div>
      <div style="margin-top:34px;height:540px;display:flex;justify-content:center;align-items:center;gap:36px">${visual}</div>
    </body>`, 1280, 800, file, 1, storeOut);
  // A large page view with the result overlapping its lower right corner.
  const overlap = (main, side) => `<div style="position:relative;width:1180px;height:540px;text-align:left">
    <div style="position:absolute;left:0;top:0">${shot(main, 840)}</div>
    <div style="position:absolute;right:0;bottom:0">${shot(side, 480)}</div></div>`;

  await storeShot('1-area.png', 'SCREENSHOT AN AREA', "Drag a box. It's already on your clipboard.",
    'Paste it straight into a chat, an email or a document, or download the PNG.',
    overlap(areaSelect, previewShot));
  await storeShot('2-full-page.png', 'WHOLE-PAGE SCREENSHOTS', 'The entire page in one sharp image.',
    'SnapStitch scrolls and stitches for you. Sticky headers appear once, not on every part.',
    shot(onScreen, 600) + `<div style="max-height:520px;overflow:hidden;border-radius:10px;
      box-shadow:0 14px 40px rgba(30,27,75,.22)">${shot(stitched, 300, 'box-shadow:none;border-radius:0')}</div>`);
  await storeShot('3-record.png', 'SCREEN RECORDER', 'Record your tab as MP4 and GIF.',
    'Your pointer and clicks are drawn in. The outline and Stop bar never show up in the video.',
    overlap(recordingShot, previewRecording));
  const key = (k, label) => `<div style="display:flex;justify-content:space-between;gap:24px;padding:11px 0;
    border-bottom:1px solid #c7d2fe;font-size:18px"><span>${label}</span><b style="font:600 16px ui-monospace,Consolas,monospace;
    color:#3730a3">${k}</b></div>`;
  await storeShot('4-popup.png', 'ONE CLICK OR ONE SHORTCUT', 'Every capture is a click away.',
    "Light and dark mode. Change any shortcut in your browser's settings.",
    `<img src="${popupLight.src}" width="340" style="border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.18)">
     <img src="${popupDark.src}" width="340" style="border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.4)">
     <div style="width:360px;text-align:left;margin-left:10px">
       ${key('Alt+Shift+S', 'Screenshot an area')}${key('Alt+Shift+V', 'Screenshot the visible page')}
       ${key('Alt+Shift+F', 'Screenshot the whole page')}${key('Alt+Shift+G', 'Record an area')}</div>`);
  const promise = (title, text) => `<div style="padding:30px 32px;border-radius:16px;background:#fff;
    text-align:left;box-shadow:0 14px 40px rgba(30,27,75,.12)"><div style="font-size:30px;font-weight:800">${title}</div>
    <div style="margin-top:10px;font-size:20px;line-height:1.5;color:#4b5563">${text}</div></div>`;
  await storeShot('5-private.png', 'PRIVATE BY DESIGN', 'Nothing leaves your computer.',
    'Captures stay in your browser until you download them. Free and open source.',
    `<div style="width:980px;display:grid;grid-template-columns:1fr 1fr;gap:28px">`
    + promise('No account', 'Nothing to sign up for, nothing to log into.')
    + promise('No uploads', 'SnapStitch makes no network requests at all.')
    + promise('No tracking', 'No analytics, no ads, no remote code.')
    + promise('Open source', 'Every line is public under the MIT license.') + '</div>');

  await render(`
    <body style="margin:0;height:100vh;overflow:hidden;font-family:system-ui;color:#111827;display:flex;
      flex-direction:column;justify-content:center;padding-left:34px;
      background:radial-gradient(circle at 90% 15%,#c7d2fe,transparent 50%),linear-gradient(135deg,#eef2ff,#e0f2fe)">
      <div style="display:flex;align-items:center;gap:14px">
        <img src="${icon}" width="58" height="58">
        <div style="font-size:42px;font-weight:800;letter-spacing:-1px">SnapStitch</div>
      </div>
      <div style="margin-top:16px;font-size:21px;font-weight:700;line-height:1.3">Screenshot and record.<br>Everything stays on your PC.</div>
    </body>`, 440, 280, 'promo-tile.png', 1, storeOut);

  // Marquee tile: shown only if the store features SnapStitch on its home page.
  await render(`
    <body style="margin:0;height:100vh;overflow:hidden;font-family:system-ui;color:#111827;display:flex;
      align-items:center;gap:56px;padding-left:80px;
      background:radial-gradient(circle at 88% 12%,#c7d2fe,transparent 45%),linear-gradient(135deg,#eef2ff,#e0f2fe)">
      <div style="flex:none;width:470px">
        <div style="display:flex;align-items:center;gap:18px">
          <img src="${icon}" width="84" height="84">
          <div style="font-size:62px;font-weight:800;letter-spacing:-1.5px">SnapStitch</div>
        </div>
        <div style="margin-top:24px;font-size:30px;font-weight:700;line-height:1.3">Screenshot and record.<br>Everything stays on your PC.</div>
        <div style="margin-top:14px;font-size:20px;line-height:1.5;color:#4b5563">Areas, whole pages, MP4 and GIF.<br>No account, no uploads.</div>
      </div>
      <div style="position:relative;width:780px;height:440px">
        <div style="position:absolute;left:0;top:0">${shot(areaSelect, 600)}</div>
        <div style="position:absolute;right:0;bottom:0">${shot(previewShot, 360)}</div>
      </div>
    </body>`, 1400, 560, 'marquee-tile.png', 1, storeOut);

  console.log(`README images written to ${path.relative(root, out)}/, store images to ${path.relative(root, storeOut)}/`);
} finally {
  await browser.close();
}
