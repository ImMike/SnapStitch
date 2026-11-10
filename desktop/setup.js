// Registers the native messaging host (host/host.js) with Chrome, Edge and
// Brave for the current user, and writes the .ico the jump list uses.
// Idempotent: the app runs it at start and when the extension IDs change, which
// also picks up a moved or reinstalled app.
// (Brave reads the Google\Chrome key; its own key is written in case that changes.)

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./store.js');

const HOST_NAME = 'com.snapstitch.desktop';
const REG_KEYS = [
  'Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser',
].map((b) => `HKCU\\Software\\${b}\\NativeMessagingHosts\\${HOST_NAME}`);

const hostDir = () => path.join(dataDir(), 'host');
const manifestPath = () => path.join(hostDir(), `${HOST_NAME}.json`);
const icoPath = () => path.join(dataDir(), 'SnapStitch.ico');

function reg(...args) {
  execFileSync('reg', args, { stdio: 'ignore', windowsHide: true });
}

// The browser starts the host through host.cmd, which runs this app's own
// executable as plain Node (electron.exe in development, SnapStitch Desktop.exe
// when installed).
function registerHost(extensionIds, exe) {
  fs.mkdirSync(hostDir(), { recursive: true });
  const launcher = path.join(hostDir(), 'host.cmd');
  writeIfChanged(launcher, ['@echo off', 'set ELECTRON_RUN_AS_NODE=1',
    `"${exe}" "${path.join(__dirname, 'host', 'host.js')}" %*`, ''].join('\r\n'));
  const manifest = JSON.stringify({
    name: HOST_NAME,
    description: 'SnapStitch Desktop: hands desktop captures to the SnapStitch extension',
    path: launcher,
    type: 'stdio',
    allowed_origins: [...new Set(extensionIds)].map((id) => `chrome-extension://${id}/`),
  }, null, 2);
  writeIfChanged(manifestPath(), manifest);
  for (const key of REG_KEYS) reg('add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath(), '/f');
}

function writeIfChanged(file, text) {
  let current = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {}
  if (current !== text) fs.writeFileSync(file, text);
}

function unregisterHost() {
  for (const key of REG_KEYS) {
    try {
      reg('delete', key, '/f');
    } catch {} // not there
  }
  fs.rmSync(hostDir(), { recursive: true, force: true });
}

// An .ico made of the PNG icons (Windows Vista+ reads PNG-compressed entries).
function writeIco(iconsDir) {
  const pngs = [16, 32, 48, 128].map((size) => ({ size, data: fs.readFileSync(path.join(iconsDir, `${size}.png`)) }));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size % 256, e); // 0 means 256
    header.writeUInt8(size % 256, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(icoPath(), Buffer.concat([header, ...pngs.map((p) => p.data)]));
  return icoPath();
}

module.exports = { HOST_NAME, registerHost, unregisterHost, writeIco, icoPath };
