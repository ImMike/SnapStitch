// Imports a capture taken by SnapStitch Desktop, the Windows tray app. The app
// opens preview.html?desktop=<id>; this asks the app's native messaging host
// (desktop/host/host.js) for the files, stores them like any other capture and
// then lets the host delete its copy. Messages are listed in host.js.
import { putShot, pruneShots } from './db.js';

const HOST = 'com.snapstitch.desktop';
const FIELDS = ['blob', 'video', 'gif'];
const CREDIT_EVERY = 4 * 1024 * 1024; // the host stays at most 8 MiB ahead

const fromBase64 = Uint8Array.fromBase64?.bind(Uint8Array)
  ?? ((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

// Resolves with the stored shot. `connect` is replaceable for tests.
export function importDesktopShot(id, { onWaiting, connect = (name) => chrome.runtime.connectNative(name) } = {}) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime.connectNative) {
      // Updated from a version without the nativeMessaging permission.
      throw new Error('Reload SnapStitch on your browser\'s extensions page so it can receive desktop captures.');
    }
    const port = connect(HOST);
    let meta = null;
    const parts = {}; // field → Blob[]; one Blob per chunk lets Chrome keep them on disk
    let received = 0;
    let credited = 0;
    let settled = false;

    function fail(message) {
      if (settled) return;
      settled = true;
      port.disconnect();
      reject(new Error(message));
    }

    port.onMessage.addListener(async (msg) => {
      switch (msg.type) {
        case 'waiting':
          onWaiting?.();
          break;
        case 'meta':
          if (!msg.parts.every((p) => FIELDS.includes(p.field))) return fail('Unexpected desktop capture files.');
          meta = msg;
          for (const p of msg.parts) parts[p.field] = [];
          break;
        case 'chunk': {
          if (!parts[msg.field]) return fail('Unexpected desktop capture data.');
          const bytes = fromBase64(msg.data);
          parts[msg.field].push(new Blob([bytes]));
          received += bytes.length;
          if (received - credited >= CREDIT_EVERY) {
            credited = received;
            port.postMessage({ type: 'more', received });
          }
          break;
        }
        case 'end': {
          if (!meta) return fail('Unexpected end of desktop capture.');
          const shot = { ...meta.shot, id, url: '', source: 'desktop' };
          for (const p of meta.parts) {
            shot[p.field] = new Blob(parts[p.field], { type: p.type });
            if (shot[p.field].size !== p.size) return fail('The desktop capture arrived incomplete.');
          }
          try {
            await putShot(shot);
            await pruneShots();
          } catch (err) {
            return fail(`Couldn't store the desktop capture: ${err.message}`);
          }
          settled = true;
          port.postMessage({ type: 'ack' }); // the host deletes its copy and exits
          resolve(shot);
          break;
        }
        case 'error':
          fail(msg.message);
          break;
      }
    });

    port.onDisconnect.addListener(() => fail(describe(chrome.runtime.lastError?.message)));
    port.postMessage({ type: 'get', id });
  });
}

function describe(error = '') {
  if (error.includes('not found')) {
    return "SnapStitch Desktop isn't set up for this browser. Start SnapStitch Desktop and it sets itself up.";
  }
  if (error.includes('forbidden')) {
    return "SnapStitch Desktop doesn't know this browser profile yet. Restart SnapStitch Desktop.";
  }
  return `Lost the connection to SnapStitch Desktop${error ? ` (${error})` : ''}.`;
}
