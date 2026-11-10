// End-to-end check on this PC's real screens: starts SnapStitch Desktop with a
// test hook (it records capture ids instead of opening your browser), takes a
// screenshot of all screens and of one screen, records the screen for ~3 s,
// then opens each capture the way the browser would: headless Chrome for
// Testing with the extension, preview.html?desktop=<id>, the real native host.
//
//   cd test && npm install          (once: puppeteer for the extension tests)
//   cd desktop && npm run self-test (quit SnapStitch Desktop first)
//   SNAPSTITCH_EXE="dist\win-unpacked\SnapStitch Desktop.exe" npm run self-test   (the packaged app)
//
// A small Stop bar shows on the screen with the pointer during the recording.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(desktop);
const electron = path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe');
const { default: puppeteer } = await import(pathToFileURL(path.join(repo, 'test', 'node_modules', 'puppeteer', 'lib', 'puppeteer', 'puppeteer.js')).href)
  .catch(() => {
    throw new Error('Run "npm install" in the test folder first (the self-test borrows its puppeteer).');
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = path.join(os.tmpdir(), `snapstitch-self-test-${Date.now()}.log`);
const env = { ...process.env, SNAPSTITCH_TEST_LOG: log };
for (const k of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|CHROME_CRASHPAD)/.test(k)) delete env[k];
// Development: electron.exe <desktop folder>. Packaged: the app's own .exe.
const [exe, appArgs] = process.env.SNAPSTITCH_EXE ? [path.resolve(process.env.SNAPSTITCH_EXE), []] : [electron, [desktop]];
const run = (...args) => execFileSync(exe, [...appArgs, ...args], { env, stdio: 'ignore' });

async function nextCapture(before) {
  for (let i = 0; i < 100; i++) {
    const ids = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')[1]) : [];
    if (ids.length > before) return ids.at(-1);
    await sleep(100);
  }
  throw new Error('no capture');
}

let failures = 0;
async function check(name, fn) {
  try {
    console.log(`  ok    ${name}${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const app = spawn(exe, [...appArgs, '--hidden'], { env, stdio: 'ignore' });
let appExited = false;
app.on('exit', () => (appExited = true));
await sleep(3000); // start-up: registers the host, creates the overlays
if (appExited) {
  // Another instance has the single-instance lock and would get our actions.
  throw new Error('SnapStitch Desktop is already running. Quit it (tray icon → Quit) and run the self-test again.');
}
// The extension asks for nativeMessaging when the first desktop capture
// arrives, and tests can't click Chrome's prompt. So test a copy that has the
// permission up front, and let the host accept that copy during the test.
const extensionCopy = fs.mkdtempSync(path.join(os.tmpdir(), 'snapstitch-ext-'));
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
manifest.permissions.push(...manifest.optional_permissions);
delete manifest.optional_permissions;
fs.writeFileSync(path.join(extensionCopy, 'manifest.json'), JSON.stringify(manifest));
for (const dir of ['src', 'icons']) fs.cpSync(path.join(repo, dir), path.join(extensionCopy, dir), { recursive: true });
const hostManifest = path.join(process.env.LOCALAPPDATA, 'SnapStitch', 'host', 'com.snapstitch.desktop.json');
const registered = fs.readFileSync(hostManifest, 'utf8');

const browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: [extensionCopy] });
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker');
  const extensionId = new URL(sw.url()).host;
  const host = JSON.parse(registered);
  host.allowed_origins.push(`chrome-extension://${extensionId}/`);
  fs.writeFileSync(hostManifest, JSON.stringify(host, null, 2));
  let count = 0;

  async function open(id) {
    const page = await browser.newPage();
    const started = Date.now();
    await page.goto(`chrome-extension://${extensionId}/src/preview.html?desktop=${id}`);
    await page.waitForFunction(() => !/Loading|Finishing/.test(document.getElementById('title').textContent), { timeout: 60000 });
    const shown = await page.evaluate(() => ({
      search: location.search, title: document.getElementById('title').textContent,
      meta: document.getElementById('meta').textContent, error: document.getElementById('empty').textContent,
      image: document.getElementById('shot').naturalWidth, video: document.getElementById('video').src.slice(0, 5),
    }));
    if (shown.error) throw new Error(shown.error);
    if (shown.search !== `?id=${id}`) throw new Error(`not stored: ${JSON.stringify(shown)}`);
    if (fs.existsSync(path.join(process.env.LOCALAPPDATA, 'SnapStitch', 'captures', id))) throw new Error('capture folder left behind');
    return { ...shown, ms: Date.now() - started };
  }

  await check('all screens', async () => {
    run('--action=screens');
    const shown = await open(await nextCapture(count++));
    if (!shown.meta.startsWith('All screens')) throw new Error(shown.meta);
    return ` (${shown.meta}, opened in ${shown.ms} ms)`;
  });

  await check('full screen', async () => {
    run('--action=screen');
    const shown = await open(await nextCapture(count++));
    if (!/^Full screen · Screen/.test(shown.meta)) throw new Error(shown.meta);
    return ` (${shown.meta})`;
  });

  await check('record full screen ~3 s', async () => {
    run('--action=record-screen');
    await sleep(3000);
    run('--action=record-screen'); // same shortcut stops
    const shown = await open(await nextCapture(count++));
    const seconds = Number(shown.meta.match(/· 0:(\d\d) ·/)?.[1]);
    if (!/^Screen recording/.test(shown.meta) || !(seconds >= 2 && seconds <= 5) || shown.video !== 'blob:') throw new Error(shown.meta);
    return ` (${shown.meta})`;
  });
} finally {
  await browser.close();
  app.kill();
  fs.writeFileSync(hostManifest, registered);
  fs.rmSync(extensionCopy, { recursive: true, force: true });
  fs.rmSync(log, { force: true });
}
console.log(failures ? `\n${failures} failed` : '\nSelf-test passed');
process.exitCode = failures ? 1 : 0;
