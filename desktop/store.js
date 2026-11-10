// Where desktop captures wait for the browser. The tray app writes each one to
// <captures>/<id>/ and writes meta.json last, so meta.json means "complete";
// host/host.js hands the folder to the preview page and deletes it.
// Plain Node only: host.js loads this without Electron.

const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELDS = ['blob', 'video', 'gif']; // the shot fields src/db.js stores Blobs in
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const dataDir = () => path.join(process.env.LOCALAPPDATA, 'SnapStitch');
const capturesDir = () => path.join(dataDir(), 'captures');

// Creates the folder for a new capture. The browser can be asked for it right
// away: the host waits until meta.json appears.
function createCapture(id) {
  const dir = path.join(capturesDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// parts: [{ field, file, type }], files already written into the folder.
function finishCapture(id, shot, parts) {
  const dir = path.join(capturesDir(), id);
  const tmp = path.join(dir, 'meta.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ shot, parts }));
  fs.renameSync(tmp, path.join(dir, 'meta.json'));
}

function discardCapture(id) {
  fs.rmSync(path.join(capturesDir(), id), { recursive: true, force: true });
}

// Captures the browser never picked up (e.g. it was uninstalled).
function pruneCaptures() {
  let names = [];
  try {
    names = fs.readdirSync(capturesDir());
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(capturesDir(), name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > MAX_AGE_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = {
  ID_PATTERN, FIELDS, dataDir, capturesDir, createCapture, finishCapture, discardCapture, pruneCaptures,
};
