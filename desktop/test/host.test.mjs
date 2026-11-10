// Tests for the native messaging host (host/host.js), driven over stdio the way
// the browser does it. Run: node --test test/
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'host', 'host.js');
const MAX_MESSAGE = 1024 * 1024; // Chrome's limit for host → browser messages

function startHost() {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'snapstitch-host-'));
  const env = { ...process.env, LOCALAPPDATA: local };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [HOST, 'chrome-extension://test/'], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const messages = [];
  const sizes = [];
  let waiters = [];
  let buffer = Buffer.alloc(0);
  child.stdout.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const len = buffer.readUInt32LE(0);
      sizes.push(len);
      messages.push(JSON.parse(buffer.subarray(4, 4 + len)));
      buffer = buffer.subarray(4 + len);
      waiters = waiters.filter((w) => !w());
    }
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return {
    captures: path.join(local, 'SnapStitch', 'captures'),
    messages,
    sizes,
    exited,
    send(msg) {
      const body = Buffer.from(JSON.stringify(msg));
      const head = Buffer.alloc(4);
      head.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([head, body]));
    },
    // Resolves once a message matching fn has arrived.
    until(fn, ms = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out; got ${messages.map((m) => m.type)}`)), ms);
        const check = () => {
          const m = messages.find(fn);
          if (m) {
            clearTimeout(timer);
            resolve(m);
          }
          return Boolean(m);
        };
        if (!check()) waiters.push(check);
      });
    },
    close: () => child.stdin.end(),
    kill: () => child.kill(),
    cleanup: () => fs.rmSync(local, { recursive: true, force: true }),
  };
}

function writeCapture(captures, files, { meta = true, parts } = {}) {
  const id = crypto.randomUUID();
  const dir = path.join(captures, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  parts ??= Object.keys(files).map((file) => ({ field: file === 'image.png' ? 'blob' : file.endsWith('.gif') ? 'gif' : 'video', file, type: 'application/octet-stream' }));
  const writeMeta = () => fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ shot: { mode: 'screen', width: 1, height: 1 }, parts }));
  if (meta) writeMeta();
  return { id, dir, writeMeta };
}

const joined = (messages, field) =>
  Buffer.concat(messages.filter((m) => m.type === 'chunk' && m.field === field).map((m) => Buffer.from(m.data, 'base64')));

test('streams a capture, deletes it after ack, exits', async () => {
  const host = startHost();
  try {
    const png = crypto.randomBytes(1_300_000);
    const { id, dir } = writeCapture(host.captures, { 'image.png': png });
    host.send({ type: 'get', id });
    const meta = await host.until((m) => m.type === 'meta');
    assert.deepEqual(meta.parts, [{ field: 'blob', type: 'application/octet-stream', size: png.length }]);
    await host.until((m) => m.type === 'end');
    assert.ok(joined(host.messages, 'blob').equals(png), 'bytes intact');
    assert.ok(fs.existsSync(dir), 'kept until ack');
    host.send({ type: 'ack' });
    assert.equal(await host.exited, 0);
    assert.equal(fs.existsSync(dir), false, 'deleted after ack');
    assert.ok(Math.max(...host.sizes) < MAX_MESSAGE, `largest message ${Math.max(...host.sizes)}`);
  } finally {
    host.kill();
    host.cleanup();
  }
});

test('stays within the credit window until the page reports progress', async () => {
  const host = startHost();
  try {
    const video = crypto.randomBytes(20 * 1024 * 1024);
    const { id } = writeCapture(host.captures, { 'video.mp4': video, 'video.gif': Buffer.from('GIF89a') });
    host.send({ type: 'get', id });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const sentBeforeCredit = joined(host.messages, 'video').length;
    assert.ok(sentBeforeCredit > 8 * 1024 * 1024 && sentBeforeCredit <= 9 * 1024 * 1024, `sent ${sentBeforeCredit}`);
    assert.ok(!host.messages.some((m) => m.type === 'end'));
    for (let received = 4; received <= 20; received += 4) host.send({ type: 'more', received: received * 1024 * 1024 });
    await host.until((m) => m.type === 'end');
    assert.ok(joined(host.messages, 'video').equals(video));
    assert.equal(joined(host.messages, 'gif').toString(), 'GIF89a');
  } finally {
    host.kill();
    host.cleanup();
  }
});

test('waits for a capture that is still being written', async () => {
  const host = startHost();
  try {
    const { id, writeMeta } = writeCapture(host.captures, { 'image.png': Buffer.from('png') }, { meta: false });
    host.send({ type: 'get', id });
    await host.until((m) => m.type === 'waiting');
    assert.ok(!host.messages.some((m) => m.type === 'meta'));
    writeMeta();
    await host.until((m) => m.type === 'end');
  } finally {
    host.kill();
    host.cleanup();
  }
});

test('rejects missing captures, bad ids and paths outside the capture', async () => {
  const cases = [
    [(c) => ({ id: crypto.randomUUID() }), 'not-found'],
    [() => ({ id: '..\\..\\Windows' }), 'bad-request'],
    [(c) => ({ id: writeCapture(c, { 'image.png': Buffer.from('x') }, { parts: [{ field: 'blob', file: '..\\meta.json', type: 'x' }] }).id }), 'bad-request'],
    [(c) => ({ id: writeCapture(c, { 'image.png': Buffer.from('x') }, { parts: [{ field: 'url', file: 'image.png', type: 'x' }] }).id }), 'bad-request'],
  ];
  for (const [make, code] of cases) {
    const host = startHost();
    try {
      host.send({ type: 'get', ...make(host.captures) });
      const error = await host.until((m) => m.type === 'error');
      assert.equal(error.code, code);
      assert.ok(!host.messages.some((m) => m.type === 'chunk'), 'sent nothing');
      assert.notEqual(await host.exited, 0);
    } finally {
      host.kill();
      host.cleanup();
    }
  }
});

test('exits when the browser closes the connection', async () => {
  const host = startHost();
  try {
    host.close();
    assert.equal(await host.exited, 0);
  } finally {
    host.cleanup();
  }
});
