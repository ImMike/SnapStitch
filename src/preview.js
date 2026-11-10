import { getShot, deleteShot } from './db.js';
import { importDesktopShot } from './desktop-import.js';

const MODE_LABELS = {
  region: 'Selected area',
  visible: 'Visible page',
  full: 'Whole page',
  'record-area': 'Area recording',
  'record-visible': 'Page recording',
  // Desktop captures (SnapStitch Desktop)
  'screen-area': 'Selected area',
  screen: 'Full screen',
  screens: 'All screens',
  'record-screen-area': 'Area recording',
  'record-screen': 'Screen recording',
};

const DESKTOP_PERMISSION = { permissions: ['nativeMessaging'] };

const $ = (id) => document.getElementById(id);
const img = $('shot');
const video = $('video');

const params = new URLSearchParams(location.search);
let missing = ['Capture not found', 'Only the 20 most recent screenshots and 5 most recent recordings are kept.'];
const shot = params.has('desktop')
  ? await loadDesktopShot(params.get('desktop'))
  : params.get('id') && (await getShot(params.get('id')));

if (!shot) {
  [$('title').textContent, $('empty').textContent] = missing;
  $('empty').hidden = false;
  $('download').hidden = true;
} else {
  if (shot.kind === 'video') showRecording();
  else showScreenshot();
  $('delete').hidden = false;
  $('delete').addEventListener('click', remove);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) remove();
  });
}

// The desktop app opens ?desktop=<id>; once stored, the tab becomes ?id=<id>
// so reloading it works like for any other capture.
async function loadDesktopShot(id) {
  if (!(await chrome.permissions.contains(DESKTOP_PERMISSION))) await askDesktopPermission();
  $('title').textContent = 'Loading desktop capture…';
  try {
    const result = await importDesktopShot(id, {
      onWaiting: () => ($('title').textContent = 'Finishing desktop capture…'),
    });
    history.replaceState(null, '', `?id=${id}`);
    return result;
  } catch (err) {
    missing = ['Desktop capture not available', err.message];
    return null;
  }
}

// Receiving desktop captures (native messaging) is an optional permission, so
// people who never install the desktop app are never asked for it. Requests
// need a click; the tab then reloads, because only pages loaded after the
// grant get the native messaging API. Never resolves.
function askDesktopPermission() {
  $('title').textContent = 'Desktop capture waiting';
  $('download').hidden = true;
  $('permission').hidden = false;
  $('allow').addEventListener('click', async () => {
    if (await chrome.permissions.request(DESKTOP_PERMISSION)) location.reload();
  });
  return new Promise(() => {});
}

function showHeader(details) {
  const host = hostOf(shot.url);
  const label = shot.title || host || 'Capture';
  document.title = `${shot.kind === 'video' ? 'Recording' : 'Screenshot'} – ${label}`;
  $('title').textContent = label;
  const meta = $('meta');
  meta.textContent = [MODE_LABELS[shot.mode], shot.display, `${shot.width} × ${shot.height} px`, ...details]
    .filter(Boolean).join(' · ');
  if (host) {
    const link = Object.assign(document.createElement('a'), {
      href: shot.url, textContent: shot.url, target: '_blank', rel: 'noopener',
    });
    meta.append(' · ', link);
  }
}

function showScreenshot() {
  showHeader(shot.scaledDown ? ['scaled down to fit browser canvas limits'] : []);
  img.src = URL.createObjectURL(shot.blob);
  showMedia(img);

  const save = () => download(img.src, 'screenshot', 'png');
  $('copy').hidden = false;
  $('copy').addEventListener('click', () => copy());
  $('download').addEventListener('click', save);
  onShortcut({ c: copy, s: save });

  if (shot.mode === 'region' || shot.mode === 'screen-area') {
    // Clipboard writes need a focused document; wait for focus if needed.
    if (document.hasFocus()) copy({ auto: true });
    else addEventListener('focus', () => copy({ auto: true }), { once: true });
  }
}

function showRecording() {
  const ext = shot.video.type === 'video/webm' ? 'webm' : 'mp4';
  showHeader([
    formatDuration(shot.duration),
    `${ext.toUpperCase()} ${formatSize(shot.video.size)}`,
    `GIF ${formatSize(shot.gif.size)}`,
  ]);
  video.src = URL.createObjectURL(shot.video);
  img.src = URL.createObjectURL(shot.gif);
  showMedia(video);

  // MP4 / GIF view toggle.
  $('views').hidden = false;
  for (const button of $('views').querySelectorAll('button')) {
    button.textContent = button.dataset.view === 'video' ? ext.toUpperCase() : 'GIF';
    button.addEventListener('click', () => {
      for (const b of $('views').querySelectorAll('button')) b.setAttribute('aria-pressed', b === button);
      showMedia(button.dataset.view === 'video' ? video : img);
      if (button.dataset.view === 'video') video.play();
      else video.pause();
    });
  }

  const saveVideo = () => download(video.src, 'recording', ext);
  $('download').textContent = `Download ${ext.toUpperCase()}`;
  $('download').addEventListener('click', saveVideo);
  $('download-gif').hidden = false;
  $('download-gif').addEventListener('click', () => download(img.src, 'recording', 'gif'));
  onShortcut({ s: saveVideo });
}

// Shows one media element at 1 image px per device px; wide ones start
// fitted to the window and toggle to actual size on click.
function showMedia(el) {
  for (const other of [img, video]) other.hidden = other !== el;
  el.style.width = `${shot.width / devicePixelRatio}px`;
  updateZoomable();
}

function updateZoomable() {
  for (const el of [img, video]) {
    el.classList.toggle('zoomable', shot.width / devicePixelRatio > el.parentElement.clientWidth);
  }
}
addEventListener('resize', updateZoomable);
img.addEventListener('click', () => {
  if (img.classList.contains('zoomable') || img.classList.contains('actual')) img.classList.toggle('actual');
});

function onShortcut(actions) {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const action = actions[e.key.toLowerCase()];
    if (!action || (e.key.toLowerCase() === 'c' && getSelection().toString())) return;
    e.preventDefault();
    action();
  });
}

async function copy({ auto = false } = {}) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': shot.blob })]);
    toast('Copied to clipboard');
  } catch (err) {
    toast(auto ? 'Press Copy to put it on the clipboard' : `Copy failed: ${err.message}`, !auto);
  }
}

function download(url, prefix, ext) {
  const stamp = new Date(shot.createdAt).toLocaleString('sv-SE').replace(' ', '_').replaceAll(':', '-');
  const where = shot.source === 'desktop' ? 'desktop' : hostOf(shot.url).replace(/[^a-z0-9.-]+/gi, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prefix}_${where ? `${where}_` : ''}${stamp}.${ext}`;
  a.click();
}

// Removes the capture from SnapStitch and closes the tab. (Closing the tab
// without deleting keeps it among the recent captures.)
async function remove() {
  await deleteShot(shot.id);
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
}

function hostOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return /^(https?|file):$/.test(protocol) ? hostname || 'file' : '';
  } catch {
    return '';
  }
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatSize(bytes) {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

let toastTimer;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
