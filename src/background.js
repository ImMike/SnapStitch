import { putShot, pruneShots } from './db.js';
import { prepareFullPage, scrollToTile, restoreFullPage } from './page-fns.js';

const MAX_PAGE_HEIGHT = 60000; // CSS px; bounds infinite-scroll pages
const MAX_CANVAS_SIDE = 32767; // Chrome canvas limits
const MAX_CANVAS_AREA = 268435456;
const CAPTURE_GAP_MS = 550; // Chrome allows 2 captureVisibleTab calls per second
const RECORD_MAX_MS = 10 * 60 * 1000;
const RECORD_COLOR = '#dc2626';

let busy = false;
let lastCaptureAt = 0;

chrome.commands.onCommand.addListener(async (command, tab) => {
  // Either record shortcut stops a recording in progress.
  if (command.startsWith('record-') && (await getRecording())) return stopRecording(false);
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (tab) start(command.replace('capture-', ''), tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'start':
      chrome.tabs.get(msg.tabId).then((tab) => start(msg.mode, tab), showError);
      sendResponse({ ok: true });
      break;
    case 'region':
      if (msg.purpose === 'record') startRecording(sender.tab, msg.rect).catch(recordingFailed);
      else run(sender.tab, () => captureRegion(sender.tab, msg.rect, msg.innerWidth));
      break;
    case 'record-stop':
    case 'record-cancel':
      stopRecording(msg.type === 'record-cancel');
      break;
    case 'recording-tick':
      setBadge(`${Math.floor(msg.elapsed / 60)}:${String(msg.elapsed % 60).padStart(2, '0')}`, RECORD_COLOR);
      break;
    case 'recording-done':
      finishRecording(msg.id).catch(showError);
      break;
    case 'recording-error':
      recordingFailed(new Error(msg.message));
      break;
  }
});

function start(mode, tab) {
  switch (mode) {
    case 'region':
      return pickArea(tab, 'screenshot');
    case 'visible':
      return run(tab, () => captureVisible(tab));
    case 'full':
      return run(tab, () => captureFull(tab));
    case 'record-area':
      return pickArea(tab, 'record');
    case 'record-visible':
      return startRecording(tab, null).catch(recordingFailed);
  }
}

// Selection runs in the page; work continues when it reports back a 'region'.
async function pickArea(tab, purpose) {
  const target = { tabId: tab.id };
  try {
    await chrome.scripting.executeScript({
      target, func: (p) => (window.__snapstitchOverlayPurpose = p), args: [purpose],
    });
    await chrome.scripting.executeScript({ target, files: ['src/overlay.js'] });
  } catch (err) {
    showError(err);
  }
}

// --- Recording -------------------------------------------------------------
// The offscreen document (recorder.js) does the capture and encoding. Session
// storage remembers the recording so the popup and a restarted service worker
// can see it.

async function getRecording() {
  const { recording } = await chrome.storage.session.get('recording');
  if (!recording) return null;
  const docs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (docs.length) return recording;
  await chrome.storage.session.remove('recording'); // recorder is gone; stale state
  return null;
}

async function startRecording(tab, rect) {
  if (await getRecording()) return stopRecording(false);
  const target = { tabId: tab.id };
  const [{ result: page }] = await chrome.scripting.executeScript({
    target, func: () => ({ innerWidth, innerHeight, dpr: devicePixelRatio, url: location.href, title: document.title }),
  });
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

  // Any leftover recorder is from a run that died; start clean.
  if ((await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
    await chrome.offscreen.closeDocument();
  }
  await chrome.offscreen.createDocument({
    url: 'src/recorder.html', reasons: ['USER_MEDIA'], justification: 'Record the current tab',
  });
  const mode = rect ? 'record-area' : 'record-visible';
  const reply = await chrome.runtime.sendMessage({
    type: 'recorder-start', streamId, rect, mode, maxMs: RECORD_MAX_MS, ...page,
  });
  if (reply?.error) throw new Error(reply.error);

  await chrome.storage.session.set({ recording: { tabId: tab.id, mode, startedAt: Date.now() } });
  setBadge('0:00', RECORD_COLOR);
  // Cursor tracking (and the area outline + Stop bar) in the page.
  await chrome.scripting.executeScript({ target, func: (r) => (window.__snapstitchRecArea = r), args: [rect] });
  await chrome.scripting.executeScript({ target, files: ['src/rec-ui.js'] });
}

async function stopRecording(discard) {
  if (await getRecording()) chrome.runtime.sendMessage({ type: discard ? 'recorder-cancel' : 'recorder-stop' });
}

async function endRecording() {
  const { recording } = await chrome.storage.session.get('recording');
  await chrome.storage.session.remove('recording');
  await chrome.offscreen.closeDocument().catch(() => {});
  setBadge('');
  return recording;
}

async function finishRecording(id) {
  const recording = await endRecording();
  if (!id) return; // discarded
  const tab = recording && (await chrome.tabs.get(recording.tabId).catch(() => null));
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/preview.html?id=${id}`),
    ...(tab && { index: tab.index + 1, openerTabId: tab.id }),
  });
}

async function recordingFailed(err) {
  await endRecording();
  showError(err);
}

// --- Screenshots -----------------------------------------------------------

// Runs one capture at a time, then stores the result and opens the preview.
async function run(tab, capture) {
  if (busy) return;
  busy = true;
  try {
    const shot = await capture();
    const { url = '', title = '' } = await chrome.tabs.get(tab.id).catch(() => tab);
    const id = crypto.randomUUID();
    await putShot({ id, ...shot, url, title, createdAt: Date.now() });
    await pruneShots();
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/preview.html?id=${id}`),
      index: tab.index + 1,
      openerTabId: tab.id,
    });
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
  }
}

async function captureVisible(tab) {
  const blob = await captureTab(tab);
  const { width, height } = await createImageBitmap(blob);
  return { mode: 'visible', blob, width, height };
}

async function captureRegion(tab, rect, innerWidth) {
  const img = await createImageBitmap(await captureTab(tab));
  const scale = img.width / innerWidth; // device px per CSS px, incl. zoom
  const sx = Math.round(rect.x * scale);
  const sy = Math.round(rect.y * scale);
  const width = Math.min(img.width - sx, Math.round(rect.width * scale));
  const height = Math.min(img.height - sy, Math.round(rect.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(img, sx, sy, width, height, 0, 0, width, height);
  return { mode: 'region', blob: await canvas.convertToBlob({ type: 'image/png' }), width, height };
}

async function captureFull(tab) {
  const target = { tabId: tab.id };
  const exec = async (func, ...args) =>
    (await chrome.scripting.executeScript({ target, func, args }))[0].result;

  // Everything below is in device pixels. Chrome snaps scroll offsets to
  // device pixels and reports them exactly, so each tile is copied 1:1 at
  // round(scroll * scale) with no resampling, even at fractional scales.
  const m = await exec(prepareFullPage, MAX_PAGE_HEIGHT);
  let canvas, ctx, scale, fit, srcW, srcH, fullW, fullH;
  let bottom = 0; // lowest page row captured so far

  try {
    let y = 0;
    let lastY = -1;
    rows: for (let row = 0; ; row++) {
      let x = 0;
      let lastX = -1;
      let pos;
      for (let col = 0; ; col++) {
        pos = await exec(scrollToTile, x, y, row + col > 0);
        // Stop if the window stopped scrolling (page shrank, or the page
        // scrolls an inner element instead of the window).
        if (col === 0 && pos.y <= lastY) break rows;
        if (col > 0 && pos.x <= lastX) break;
        lastX = pos.x;
        const img = await createImageBitmap(await captureTab(tab));

        if (!canvas) {
          scale = img.width / m.innerWidth;
          srcW = Math.min(img.width, Math.round(m.viewW * scale)); // crops scrollbars
          srcH = Math.min(img.height, Math.round(m.viewH * scale));
          fullW = Math.round(m.totalW * scale);
          fullH = Math.round(m.totalH * scale);
          fit = Math.min(1, MAX_CANVAS_SIDE / fullW, MAX_CANVAS_SIDE / fullH,
            Math.sqrt(MAX_CANVAS_AREA / (fullW * fullH)));
          canvas = new OffscreenCanvas(Math.round(fullW * fit), Math.round(fullH * fit));
          ctx = canvas.getContext('2d');
        }

        const ox = Math.round(pos.x * scale);
        const oy = Math.round(pos.y * scale);
        // Integer destination edges: exact 1:1 copy when fit is 1, and no
        // half-covered seam rows when the image has to be scaled down.
        const dx = Math.round(ox * fit);
        const dy = Math.round(oy * fit);
        ctx.drawImage(img, 0, 0, srcW, srcH,
          dx, dy, Math.round((ox + srcW) * fit) - dx, Math.round((oy + srcH) * fit) - dy);
        bottom = Math.max(bottom, oy + srcH);
        setBadge(`${Math.min(99, Math.round((bottom / fullH) * 100))}%`, '#4f46e5');

        if (ox + srcW >= fullW) break;
        x = (ox + srcW - 1) / scale; // next tile overlaps by 1 device px
      }
      lastY = pos.y;
      if (bottom >= fullH) break;
      y = (Math.round(pos.y * scale) + srcH - 1) / scale;
    }
  } finally {
    await exec(restoreFullPage).catch(() => {});
    setBadge('');
  }

  if (bottom < fullH) {
    // Window stopped scrolling early: drop the blank tail.
    const cropped = new OffscreenCanvas(canvas.width, Math.round(bottom * fit));
    cropped.getContext('2d').drawImage(canvas, 0, 0);
    canvas = cropped;
  }
  return {
    mode: 'full',
    blob: await canvas.convertToBlob({ type: 'image/png' }),
    width: canvas.width,
    height: canvas.height,
    scaledDown: fit < 1,
  };
}

// Captures the visible area of the tab as a PNG blob, respecting Chrome's
// capture rate limit.
async function captureTab(tab) {
  if (!(await chrome.tabs.get(tab.id)).active) throw new Error('Tab was switched during capture.');
  const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (err) {
    if (!String(err?.message).includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) throw err;
    await sleep(1000);
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  }
  lastCaptureAt = Date.now();
  return (await fetch(dataUrl)).blob();
}

function setBadge(text, color) {
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

function showError(err) {
  console.error('[SnapStitch]', err);
  setBadge('!', '#dc2626');
  chrome.action.setTitle({ title: `SnapStitch: ${err?.message || err}` });
  setTimeout(() => {
    setBadge('');
    chrome.action.setTitle({ title: 'SnapStitch' });
  }, 5000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Debug/test hook: snapstitch.start('full', await chrome.tabs.get(id))
globalThis.snapstitch = { start };
