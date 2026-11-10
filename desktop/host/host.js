// Native messaging host. The browser starts it (through host.cmd) when the
// preview page calls chrome.runtime.connectNative('com.snapstitch.desktop'),
// and it hands one desktop capture from disk to the page:
//   page → host: { type: 'get', id }  { type: 'more', received }  { type: 'ack' }
//   host → page: { type: 'waiting' }  { type: 'meta', shot, parts }
//                { type: 'chunk', field, data }  { type: 'end' }  { type: 'error', code, message }
// The tray app writes <captures>/<id>/meta.json last, so its presence means the
// capture is complete. After 'ack' (the page has stored it) the folder is deleted.
// stdout is the protocol channel: nothing else may be written to it.

const fs = require('node:fs');
const path = require('node:path');
const { capturesDir, ID_PATTERN, FIELDS } = require('../store.js');

const CHUNK = 512 * 1024; // 699 KB as base64: well under the 1 MB message limit
const WINDOW = 8 * 1024 * 1024; // bytes sent ahead of the page's last 'more'
const WAIT_MS = 120_000; // a long recording can take a while to finish encoding
const POLL_MS = 200;

console.log = console.info = console.warn = console.error;

let received = 0; // bytes the page has confirmed
let onCredit = null;
let dir = null;

// --- Framing: 32-bit native-endian length, then UTF-8 JSON ---------------

let input = Buffer.alloc(0);
process.stdin.on('data', (data) => {
  input = Buffer.concat([input, data]);
  while (input.length >= 4) {
    const len = input.readUInt32LE(0);
    if (input.length < 4 + len) break;
    const msg = JSON.parse(input.subarray(4, 4 + len).toString('utf8'));
    input = input.subarray(4 + len);
    handle(msg).catch((err) => fail('io', err.message));
  }
});
process.stdin.on('end', () => process.exit(0));

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  const ok = process.stdout.write(Buffer.concat([head, body]));
  return ok ? null : new Promise((resolve) => process.stdout.once('drain', resolve));
}

function fail(code, message) {
  send({ type: 'error', code, message });
  setTimeout(() => process.exit(1), 100);
}

// --- Protocol --------------------------------------------------------------

async function handle(msg) {
  switch (msg.type) {
    case 'get':
      if (dir) return fail('bad-request', 'Only one capture per connection.');
      if (!ID_PATTERN.test(msg.id ?? '')) return fail('bad-request', 'Invalid capture id.');
      dir = path.join(capturesDir(), msg.id);
      return transfer();
    case 'more':
      received = msg.received;
      onCredit?.();
      return;
    case 'ack':
      if (!dir) return;
      await fs.promises.rm(dir, { recursive: true, force: true });
      process.exit(0);
  }
}

async function transfer() {
  const meta = await waitForMeta();
  if (!meta) return;
  const parts = [];
  for (const part of meta.parts) {
    if (!FIELDS.includes(part.field) || path.basename(part.file) !== part.file) {
      return fail('bad-request', 'Invalid capture files.');
    }
    const { size } = await fs.promises.stat(path.join(dir, part.file));
    parts.push({ ...part, size });
  }
  await send({ type: 'meta', shot: meta.shot, parts: parts.map(({ field, type, size }) => ({ field, type, size })) });

  let sent = 0;
  for (const part of parts) {
    const stream = fs.createReadStream(path.join(dir, part.file), { highWaterMark: CHUNK });
    for await (const data of stream) {
      while (sent - received > WINDOW) await new Promise((resolve) => (onCredit = resolve));
      onCredit = null;
      sent += data.length;
      await send({ type: 'chunk', field: part.field, data: data.toString('base64') });
    }
  }
  await send({ type: 'end' });
}

// Resolves with the parsed meta.json, or null after reporting an error.
async function waitForMeta() {
  const file = path.join(dir, 'meta.json');
  const deadline = Date.now() + WAIT_MS;
  let told = false;
  for (;;) {
    try {
      return JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (!fs.existsSync(dir)) {
      fail('not-found', 'This desktop capture is no longer available.');
      return null;
    }
    if (Date.now() > deadline) {
      fail('timeout', 'SnapStitch Desktop did not finish the capture.');
      return null;
    }
    if (!told) {
      told = true;
      send({ type: 'waiting' });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
