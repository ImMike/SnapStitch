// Finds the browser profiles that have the SnapStitch extension, picks the one
// to open captures in, and opens a capture there. Chromium keeps no public
// registry of extensions, so this reads each profile's (Secure) Preferences
// file and recognizes SnapStitch by its manifest, wherever it was loaded from.

const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BROWSERS = [
  { key: 'brave', name: 'Brave', exe: 'brave.exe', data: 'BraveSoftware\\Brave-Browser\\User Data', progIds: ['BraveHTML'] },
  { key: 'chrome', name: 'Chrome', exe: 'chrome.exe', data: 'Google\\Chrome\\User Data', progIds: ['ChromeHTML'] },
  { key: 'edge', name: 'Edge', exe: 'msedge.exe', data: 'Microsoft\\Edge\\User Data', progIds: ['MSEdgeHTM'] },
];

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// Chromium's ID for an unpacked extension: SHA-256 of the UTF-16 path, first
// 32 hex digits, written with the letters a–p.
function unpackedId(dir) {
  const hex = crypto.createHash('sha256').update(Buffer.from(path.resolve(dir), 'utf16le')).digest('hex');
  return [...hex.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function exePath(exe) {
  for (const root of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg', ['query', `${root}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const match = out.match(/REG_SZ\s+(.+)/);
      if (match && fs.existsSync(match[1].trim().replace(/^"|"$/g, ''))) return match[1].trim().replace(/^"|"$/g, '');
    } catch {}
  }
  return null;
}

function defaultBrowserKey() {
  try {
    const out = execFileSync('reg', ['query',
      'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const progId = out.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1] ?? '';
    return BROWSERS.find((b) => b.progIds.some((p) => progId.startsWith(p)))?.key ?? null;
  } catch {
    return null;
  }
}

function isSnapStitch(dir) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  return manifest?.name === 'SnapStitch' && /github\.com\/ImMike\/SnapStitch/i.test(manifest.homepage_url ?? '');
}

// Every (browser, profile) with SnapStitch:
// [{ browser, browserName, exe, profile, profileName, extensionId, lastUsed }]
function findInstalls() {
  const checked = new Map(); // extension folder → is SnapStitch
  const installs = [];
  for (const b of BROWSERS) {
    const userData = path.join(process.env.LOCALAPPDATA, b.data);
    const state = readJson(path.join(userData, 'Local State'));
    if (!state) continue;
    const exe = exePath(b.exe);
    if (!exe) continue;
    let dirs = [];
    try {
      dirs = fs.readdirSync(userData, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {}
    for (const profile of dirs) {
      for (const file of ['Secure Preferences', 'Preferences']) {
        const settings = readJson(path.join(userData, profile, file))?.extensions?.settings ?? {};
        const id = Object.keys(settings).find((k) => {
          const where = settings[k]?.path;
          if (typeof where !== 'string') return false;
          // Unpacked: an absolute path. Store installs: relative to the profile.
          const dir = path.isAbsolute(where) ? where : path.join(userData, profile, 'Extensions', where);
          if (!checked.has(dir)) checked.set(dir, isSnapStitch(dir));
          return checked.get(dir);
        });
        if (!id) continue;
        installs.push({
          browser: b.key, browserName: b.name, exe, profile, extensionId: id,
          profileName: state.profile?.info_cache?.[profile]?.name || profile,
          lastUsed: state.profile?.last_used === profile,
        });
        break;
      }
    }
  }
  return installs;
}

// target: 'auto' or { browser, profile }. Automatic = the default browser's
// last used profile, or the closest thing to it that has SnapStitch.
function pickInstall(installs, target = 'auto') {
  if (target !== 'auto') {
    const chosen = installs.find((i) => i.browser === target.browser && i.profile === target.profile);
    if (chosen) return chosen;
  }
  const preferred = defaultBrowserKey();
  const rank = (i) => (i.browser === preferred ? 0 : 2) + (i.lastUsed ? 0 : 1);
  return [...installs].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const label = (i) => `${i.browserName} – ${i.profileName}`;

// Opens the preview for a desktop capture. Launched from the input handler,
// so Windows lets the browser come to the front (Chromium's launcher hands
// its foreground rights to the running instance), or start if it's closed.
function openCapture(install, id) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ELECTRON_|NODE_OPTIONS$|CHROME_CRASHPAD)/.test(k)) delete env[k];
  spawn(install.exe, [`--profile-directory=${install.profile}`,
    `chrome-extension://${install.extensionId}/src/preview.html?desktop=${id}`],
  { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
}

module.exports = { BROWSERS, unpackedId, findInstalls, pickInstall, label, openCapture };
