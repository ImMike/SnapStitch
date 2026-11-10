// SnapStitch Desktop: a tray app that takes screenshots and recordings of the
// Windows desktop and opens each one in the SnapStitch extension's preview,
// exactly like captures taken in the browser.
//
// Hand-off: a capture is written to %LOCALAPPDATA%\SnapStitch\captures\<id>\
// (store.js), and the browser is launched with preview.html?desktop=<id>.
// Launching it from the input handler (hotkey, click) lets Windows bring the
// browser to the front. The preview then fetches the files through the native
// messaging host (host/host.js).

const {
  app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, globalShortcut, ipcMain,
  nativeImage, net, powerMonitor, protocol, screen, session, shell,
} = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const browsers = require('./browsers.js');
const { displayAtCursor, physical, displayLabel, grabDisplays, composeAll, cropTo } = require('./capture.js');
const setup = require('./setup.js');
const store = require('./store.js');

const APP_ID = 'com.snapstitch.desktop';
// Files shared with the extension (src/, icons/): the repo in development; the
// installer copies them into resources/.
const SHARED = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const ICONS = path.join(SHARED, 'icons');
const PRELOAD = path.join(__dirname, 'preload.js');
const RECORD_MAX_MS = 10 * 60 * 1000; // same cap as the extension
const OUTLINE_GAP = 6; // area outline sits this far outside the recorded area
const BAR = { width: 236, height: 40, gap: 10 };
const DEFAULT_HOTKEYS = {
  'screen-area': 'PrintScreen',
  screen: 'Shift+PrintScreen',
  'record-screen-area': 'Control+PrintScreen',
  'record-screen': 'Control+Shift+PrintScreen',
};
const LABELS = {
  'screen-area': 'Screenshot area',
  screen: 'Screenshot full screen',
  screens: 'Screenshot all screens',
  'record-screen-area': 'Record area',
  'record-screen': 'Record full screen',
};

app.setName('SnapStitch Desktop');
protocol.registerSchemesAsPrivileged([{
  scheme: 'snapstitch',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let settings = { target: 'auto', hotkeys: { ...DEFAULT_HOTKEYS } };
let installs = [];
let tray = null;
let launcher = null;
let overlays = new Map(); // display id → window
let selection = null; // { resolve } while an area is being selected
let recording = null;
let quitting = false;
const notifications = new Set(); // keeps shown notifications from being collected

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Second launch: the pinned taskbar icon, a jump list task, or the shortcut.
  app.on('second-instance', (event, argv) => {
    const action = actionArg(argv);
    if (action) run(action);
    else showLauncher(screen.getCursorScreenPoint());
  });
  app.on('window-all-closed', () => {}); // keep running in the tray
  app.whenReady().then(start).catch((err) => fail(err));
}

async function start() {
  app.setAppUserModelId(APP_ID);
  loadSettings();
  serveAppFiles();
  blockNetwork();
  store.pruneCaptures();

  const ico = app.isPackaged ? process.execPath : setup.writeIco(ICONS);
  refreshInstalls();
  if (!app.isPackaged) {
    // The installer makes this shortcut; in development, make our own. Windows
    // needs it for notifications and for pinning the app to the taskbar.
    const link = startMenuLink();
    shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', {
      target: process.execPath, args: appArgs(), appUserModelId: APP_ID, icon: ico, iconIndex: 0,
      description: 'Screenshot or record your screen; captures open in the SnapStitch browser extension.',
    });
  }
  app.setUserTasks(Object.keys(LABELS).map((action) => ({
    program: process.execPath, arguments: `${appArgs()} --action=${action}`.trim(),
    title: LABELS[action], description: LABELS[action], iconPath: ico, iconIndex: 0,
  })));

  tray = new Tray(trayIcon(false));
  tray.setToolTip('SnapStitch Desktop');
  tray.on('click', () => showLauncher());
  rebuildMenu();
  registerHotkeys();
  createLauncher();
  createOverlays();
  let timer = 0;
  const displaysChanged = () => {
    clearTimeout(timer);
    timer = setTimeout(() => !selection && createOverlays(), 500);
  };
  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);
  powerMonitor.on('lock-screen', () => stopRecording(false, false));

  const hidden = process.argv.includes('--hidden'); // started with Windows
  if (!hidden && !settings.askedStartup) await askStartWithWindows();
  const action = actionArg(process.argv);
  if (action) run(action);
  else if (!hidden) showLauncher(screen.getCursorScreenPoint());
}

// --- Settings and setup ----------------------------------------------------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...settings, ...saved, hotkeys: { ...DEFAULT_HOTKEYS, ...saved.hotkeys } };
  } catch {}
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

// Unpackaged (npm start) the app is electron.exe plus this folder.
const appArgs = () => (app.isPackaged ? '' : `"${app.getAppPath()}"`);
// name: the Run registry value; build/installer.nsh removes it on uninstall.
const loginItem = () => ({
  name: APP_ID, path: process.execPath, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
});
const startMenuLink = () =>
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SnapStitch Desktop.lnk');

function setStartWithWindows(on) {
  app.setLoginItemSettings({ openAtLogin: on, ...loginItem() });
  rebuildMenu();
}

// Asked once, on the first launch. Starting with Windows is your choice, never a default.
async function askStartWithWindows() {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Yes', 'No'], defaultId: 0, cancelId: 1, title: 'SnapStitch Desktop',
    message: 'Start SnapStitch Desktop when Windows starts?',
    detail: 'It waits in the tray next to the clock, ready for PrtSc. You can change this any time in the tray menu.',
  });
  if (response === 0) setStartWithWindows(true);
  settings.askedStartup = true;
  saveSettings();
}

// Which browser profiles have SnapStitch; lets those talk to the host.
let registeredIds = '';
function refreshInstalls() {
  installs = browsers.findInstalls();
  const ids = installs.map((i) => i.extensionId);
  if (!app.isPackaged) ids.push(browsers.unpackedId(path.resolve(__dirname, '..'))); // this repo's extension
  const key = [...new Set(ids)].sort().join();
  if (key !== registeredIds) {
    setup.registerHost(key ? key.split(',') : [], process.execPath);
    registeredIds = key;
  }
  rebuildMenu();
}

async function removeApp() {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1, title: 'SnapStitch Desktop',
    message: 'Remove SnapStitch Desktop?',
    detail: 'This unregisters it from your browsers, stops it starting with Windows, deletes any captures '
      + 'not yet opened, and uninstalls it. The browser extension and its captures stay.',
  });
  if (response !== 0) return;
  if (recording) stopRecording(true);
  setStartWithWindows(false);
  setup.unregisterHost();
  fs.rmSync(store.dataDir(), { recursive: true, force: true });
  // Electron keeps files open in userData while running; remove what we wrote.
  fs.rmSync(settingsFile(), { force: true });
  if (app.isPackaged) {
    const uninstaller = path.join(path.dirname(process.execPath), 'Uninstall SnapStitch Desktop.exe');
    if (fs.existsSync(uninstaller)) spawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    fs.rmSync(startMenuLink(), { force: true });
  }
  quitting = true;
  app.quit();
}

// --- App files and privacy -------------------------------------------------

// Pages load from snapstitch://app/desktop/…, next to snapstitch://app/src/…,
// so desktop pages can import the extension's recorder (../src/rec-core.js)
// with no build step, in development and when installed.
function serveAppFiles() {
  protocol.handle('snapstitch', (request) => {
    const parts = path.normalize(decodeURIComponent(new URL(request.url).pathname)).split(path.sep).filter(Boolean);
    const base = parts[0] === 'desktop' ? __dirname : ['src', 'icons'].includes(parts[0]) ? SHARED : null;
    if (!base || parts.includes('..') || parts.includes('node_modules')) return new Response('Not found', { status: 404 });
    const file = parts[0] === 'desktop' ? path.join(base, ...parts.slice(1)) : path.join(base, ...parts);
    return net.fetch(pathToFileURL(file).href);
  });
}

// Nothing here needs the network; make sure nothing uses it.
function blockNetwork() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: true }));
  // Screen capture (for recording) is the one permission our pages use.
  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(['display-capture', 'media'].includes(permission) && details.requestingUrl?.startsWith('snapstitch://app/')));
  ses.setSpellCheckerEnabled(false);
}

const page = (name) => `snapstitch://app/desktop/${name}`;

function createWindow(options) {
  return new BrowserWindow({
    show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, icon: path.join(ICONS, '32.png'),
    ...options,
    webPreferences: { preload: PRELOAD, spellcheck: false, ...options.webPreferences },
  });
}

// --- Tray, menu, launcher --------------------------------------------------

// The app icon, or with a red recording dot. Both sizes, for 100% and 200% scaling.
function trayIcon(recordingDot) {
  const icon = nativeImage.createEmpty();
  for (const [size, scaleFactor] of [[16, 1], [32, 2]]) {
    const image = nativeImage.createFromPath(path.join(ICONS, `${size}.png`));
    const bitmap = image.toBitmap(); // BGRA
    if (recordingDot) {
      const r = size * 0.28;
      const c = size - r - 0.5;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > r + 1) continue;
          const i = (y * size + x) * 4;
          const [b, g, red] = d <= r ? [38, 38, 220] : [255, 255, 255]; // red dot, white ring
          bitmap[i] = b;
          bitmap[i + 1] = g;
          bitmap[i + 2] = red;
          bitmap[i + 3] = 255;
        }
      }
    }
    icon.addRepresentation({ scaleFactor, width: size, height: size, buffer: bitmap });
  }
  return icon;
}

function rebuildMenu() {
  if (!tray) return;
  const key = (action) => ({ accelerator: settings.hotkeys[action] || undefined, registerAccelerator: false });
  const busy = Boolean(selection);
  const item = (action) => ({ label: LABELS[action], click: () => run(action), enabled: !busy, ...key(action) });
  const auto = browsers.pickInstall(installs, 'auto');
  const template = [
    ...(recording ? [
      { label: recording.stopping ? 'Saving recording…' : 'Recording…', enabled: false },
      { label: 'Stop and save', click: () => stopRecording(false), enabled: !recording.stopping, ...key(recording.mode) },
      { label: 'Discard recording', click: () => stopRecording(true), enabled: !recording.stopping },
      { type: 'separator' },
    ] : []),
    item('screen-area'), item('screen'), item('screens'),
    ...(recording ? [] : [{ type: 'separator' }, item('record-screen-area'), item('record-screen')]),
    { type: 'separator' },
    {
      label: 'Open captures in',
      submenu: [
        {
          label: `Automatic${auto ? ` (${browsers.label(auto)})` : ''}`, type: 'radio', checked: settings.target === 'auto',
          click: () => setTarget('auto'),
        },
        ...installs.map((i) => ({
          label: browsers.label(i), type: 'radio',
          checked: settings.target?.browser === i.browser && settings.target?.profile === i.profile,
          click: () => setTarget({ browser: i.browser, profile: i.profile }),
        })),
        ...(installs.length ? [] : [{ label: 'SnapStitch extension not found in Chrome, Edge or Brave', enabled: false }]),
        { type: 'separator' },
        { label: 'Look again', click: refreshInstalls },
      ],
    },
    {
      label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(loginItem()).openAtLogin,
      click: (menuItem) => setStartWithWindows(menuItem.checked),
    },
    { type: 'separator' },
    { label: 'Remove SnapStitch Desktop…', click: removeApp },
    { label: 'Quit', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function setTarget(target) {
  settings.target = target;
  saveSettings();
  rebuildMenu();
}

// The popup-style window: same look and options as the extension's popup.
function createLauncher() {
  launcher = createWindow({ width: 262, height: 300, alwaysOnTop: true, useContentSize: true });
  launcher.loadURL(page('launcher.html'));
  launcher.on('blur', () => launcher.hide());
}

function launcherState() {
  const install = browsers.pickInstall(installs, settings.target);
  return {
    hotkeys: settings.hotkeys,
    recording: recording && { startedAt: recording.startedAt, stopping: Boolean(recording.stopping) },
    target: install ? browsers.label(install) : null,
  };
}

function showLauncher(point) {
  if (!launcher || selection) return;
  launcher.webContents.send('launcher-state', launcherState());
  const [w, h] = launcher.getSize();
  const anchor = point ?? (() => {
    const b = tray.getBounds();
    return { x: b.x + b.width / 2, y: b.y };
  })();
  const { workArea } = screen.getDisplayNearestPoint(anchor);
  const clamp = (v, min, max) => Math.round(Math.max(min, Math.min(v, max)));
  launcher.setPosition(
    clamp(anchor.x - w / 2, workArea.x, workArea.x + workArea.width - w),
    clamp(anchor.y - h - 8, workArea.y, workArea.y + workArea.height - h));
  launcher.show();
  launcher.focus();
}

ipcMain.on('launcher-size', (event, height) => {
  if (launcher && event.sender === launcher.webContents) launcher.setContentSize(262, Math.ceil(height));
});
ipcMain.handle('launcher-state', () => launcherState());
ipcMain.on('launcher-action', (event, action) => {
  launcher.hide();
  if (action === 'stop') stopRecording(false);
  else if (action === 'discard') stopRecording(true);
  else if (LABELS[action]) run(action);
});

// --- Actions ---------------------------------------------------------------

function actionArg(argv) {
  const action = argv.find((a) => a.startsWith('--action='))?.slice('--action='.length);
  return LABELS[action] ? action : null;
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const taken = [];
  for (const [action, key] of Object.entries(settings.hotkeys)) {
    if (!key || !LABELS[action]) continue;
    try {
      if (!globalShortcut.register(key, () => run(action))) taken.push(key);
    } catch {
      taken.push(key); // not a valid accelerator
    }
  }
  if (taken.length) {
    notify(`Shortcut ${taken.join(', ')} is not available`,
      'Another app is using it (Snipping Tool, OneDrive or another screenshot tool). '
      + 'Use the tray icon, or change "hotkeys" in settings.json and restart.');
  }
}

async function run(action) {
  if (selection) return;
  if (action.startsWith('record-') && recording) return stopRecording(false);
  try {
    switch (action) {
      case 'screen': {
        const display = displayAtCursor();
        const grab = (await grabDisplays([display])).get(display.id);
        return deliverScreenshot('screen', grab.image, displayLabel(display));
      }
      case 'screens': {
        const grabs = await grabDisplays();
        return deliverScreenshot('screens', composeAll([...grabs.values()]), null);
      }
      case 'screen-area':
        return await selectArea('screenshot');
      case 'record-screen-area':
        return await selectArea('record');
      case 'record-screen':
        return await startRecording(displayAtCursor(), null);
    }
  } catch (err) {
    fail(err);
  }
}

// Opens the capture's preview in the browser, before its files are written:
// the host waits for them. Call this from the input handler.
function openInBrowser(id) {
  // Test hook (desktop/test): note the capture instead of opening a browser.
  if (process.env.SNAPSTITCH_TEST_LOG) {
    fs.appendFileSync(process.env.SNAPSTITCH_TEST_LOG, `open ${id}\n`);
    return true;
  }
  const install = browsers.pickInstall(installs, settings.target);
  if (!install) {
    notify('SnapStitch extension not found',
      'Load the SnapStitch extension in Chrome, Edge or Brave, then choose "Look again" in the tray menu.');
    return false;
  }
  browsers.openCapture(install, id);
  setTimeout(refreshInstalls, 2000); // picks up a new last-used profile
  return true;
}

function deliverScreenshot(mode, image, display) {
  const id = crypto.randomUUID();
  const dir = store.createCapture(id);
  if (!openInBrowser(id)) return store.discardCapture(id);
  fs.writeFileSync(path.join(dir, 'image.png'), image.toPNG());
  const { width, height } = image.getSize();
  store.finishCapture(id, { source: 'desktop', mode, title: 'Desktop', display, width, height, createdAt: Date.now() },
    [{ field: 'blob', file: 'image.png', type: 'image/png' }]);
}

function fail(err) {
  console.error('[SnapStitch Desktop]', err);
  notify('SnapStitch Desktop', err?.message || String(err));
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ICONS, '128.png') });
  notifications.add(n);
  n.on('click', () => onClick?.());
  n.on('close', () => notifications.delete(n));
  n.show();
}

// --- Area selection --------------------------------------------------------

// One overlay per display, created ahead of time so selection starts at once.
// Content protection keeps them out of every capture.
function createOverlays() {
  for (const win of overlays.values()) win.destroy();
  overlays = new Map();
  for (const d of screen.getAllDisplays()) {
    const win = createWindow({
      ...d.bounds, alwaysOnTop: true, movable: false, enableLargerThanScreen: true, backgroundColor: '#000000',
      webPreferences: { backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.loadURL(page('overlay.html'));
    overlays.set(d.id, win);
  }
}

const overlayDisplay = (contents) => [...overlays].find(([, win]) => win.webContents === contents)?.[0];

// Freezes all screens (Gyazo-style), lets the user drag an area on one of
// them, then takes the screenshot or starts the recording.
async function selectArea(purpose) {
  const grabs = await grabDisplays();
  const active = displayAtCursor();
  const chosen = new Promise((resolve) => (selection = { resolve }));
  rebuildMenu();
  for (const [id, grab] of grabs) {
    const win = overlays.get(id);
    if (!win) continue;
    const { width, height } = grab.image.getSize();
    win.webContents.send('overlay-show', {
      purpose, width, height, bitmap: grab.image.toBitmap(), hint: id === active.id,
    });
    win.setBounds(grab.display.bounds);
    win.showInactive();
    win.setBounds(grab.display.bounds); // again: Windows may adjust bounds across mixed scaling
  }
  overlays.get(active.id)?.focus();
  globalShortcut.register('Escape', () => selection?.resolve(null));

  const result = await chosen;
  globalShortcut.unregister('Escape');
  const grab = result && grabs.get(result.displayId);
  try {
    // Open the browser while our overlay still has the focus from the mouseup.
    if (grab && purpose === 'screenshot') deliverScreenshot('screen-area', cropTo(grab, result.rect), displayLabel(grab.display));
  } finally {
    for (const win of overlays.values()) {
      win.hide();
      win.webContents.send('overlay-hide');
    }
    selection = null;
    rebuildMenu();
  }
  if (grab && purpose === 'record') await startRecording(grab.display, result.rect);
}

ipcMain.on('overlay-select', (event, rect) => {
  const displayId = overlayDisplay(event.sender);
  if (selection && displayId !== undefined) selection.resolve({ displayId, rect });
});
ipcMain.on('overlay-cancel', () => selection?.resolve(null));

// --- Recording -------------------------------------------------------------
// desktop/recorder.html runs the extension's pipeline (src/rec-core.js) on the
// screen's video track in a hidden window and streams the MP4 here.

async function startRecording(display, rect) {
  if (recording) return;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const source = sources.find((s) => s.display_id === String(display.id));
  if (!source) throw new Error("Couldn't find that screen to record.");
  const size = physical(display);
  const k = display.scaleFactor;
  const crop = rect
    ? { x: rect.x * k, y: rect.y * k, w: rect.width * k, h: rect.height * k }
    : { x: 0, y: 0, w: size.width, h: size.height };

  const id = crypto.randomUUID();
  const dir = store.createCapture(id);
  const win = createWindow({ webPreferences: { backgroundThrottling: false } });
  recording = {
    id, dir, win, display, rect, mode: rect ? 'record-screen-area' : 'record-screen', startedAt: Date.now(),
    config: { sourceId: source.id, ...size, crop, maxMs: RECORD_MAX_MS },
    out: fs.createWriteStream(path.join(dir, 'video.part')),
    ui: [],
    stopping: false,
    opened: false,
  };
  rebuildMenu();
  win.loadURL(page('recorder.html'));
  // A recorder that never starts would leave the app stuck in "recording".
  setTimeout(() => {
    if (recording?.id === id && !recording.started) {
      recording.out.destroy();
      endRecording();
      store.discardCapture(id);
      fail(new Error("Recording didn't start."));
    }
  }, 15000);
}

const fromRecorder = (event) => recording && event.sender === recording.win.webContents;

ipcMain.handle('recorder-config', (event) => (fromRecorder(event) ? recording.config : null));

ipcMain.on('rec-started', (event) => {
  if (!fromRecorder(event)) return;
  recording.started = true;
  recording.startedAt = Date.now();
  tray.setImage(trayIcon(true));
  tray.setToolTip('SnapStitch Desktop: recording');
  showRecordingUi(recording.display, recording.rect);
});

ipcMain.on('rec-tick', (event, elapsed) => {
  if (!fromRecorder(event)) return;
  const text = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  tray.setToolTip(`SnapStitch Desktop: recording ${text}`);
  for (const win of recording.ui) win.webContents.send('rec-ui-time', text);
});

ipcMain.on('rec-data', (event, bytes) => {
  if (fromRecorder(event)) recording.out.write(Buffer.from(bytes));
});

// The recorder stopped by itself: time limit, or the screen went away.
ipcMain.on('rec-stopping', (event) => {
  if (fromRecorder(event) && !recording.stopping) markStopping();
});

ipcMain.on('rec-done', async (event, result) => {
  if (!fromRecorder(event)) return;
  const rec = recording;
  await new Promise((resolve) => rec.out.end(resolve));
  endRecording();
  if (!result) return store.discardCapture(rec.id);
  const ext = result.videoType === 'video/webm' ? 'webm' : 'mp4';
  fs.renameSync(path.join(rec.dir, 'video.part'), path.join(rec.dir, `video.${ext}`));
  fs.writeFileSync(path.join(rec.dir, 'video.gif'), Buffer.from(result.gif));
  store.finishCapture(rec.id, {
    source: 'desktop', kind: 'video', mode: rec.mode, title: 'Desktop', display: displayLabel(rec.display),
    width: result.width, height: result.height, duration: result.duration, createdAt: Date.now(),
  }, [
    { field: 'video', file: `video.${ext}`, type: result.videoType },
    { field: 'gif', file: 'video.gif', type: 'image/gif' },
  ]);
  // Stopped without a click or key press (time limit, locked PC): Windows
  // wouldn't let the browser come to the front now, so offer it instead.
  if (!rec.opened) notify('Recording saved', 'Click to open it.', () => openInBrowser(rec.id));
  if (quitting) app.quit();
});

ipcMain.on('rec-error', (event, message) => {
  if (!fromRecorder(event)) return;
  const rec = recording;
  rec.out.destroy();
  endRecording();
  store.discardCapture(rec.id);
  fail(new Error(`Recording failed: ${message}`));
});

function markStopping() {
  recording.stopping = true;
  for (const win of recording.ui) win.destroy();
  recording.ui = [];
  rebuildMenu();
}

// userInput: called from a click or key press, so the browser may come to front.
function stopRecording(discard, userInput = true) {
  if (!recording || recording.stopping) return;
  markStopping();
  if (!discard && userInput) recording.opened = openInBrowser(recording.id);
  recording.win.webContents.send('rec-stop', { discard });
}

function endRecording() {
  recording.win.destroy();
  for (const win of recording.ui) win.destroy();
  recording = null;
  tray.setImage(trayIcon(false));
  tray.setToolTip('SnapStitch Desktop');
  rebuildMenu();
}

// Dashed outline around the area and a Stop bar, both outside the area where
// there is room and kept out of the video by content protection anyway.
function showRecordingUi(display, rect) {
  const area = display.workArea;
  const ui = [];
  let bar;
  if (rect) {
    const r = { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height };
    const outline = createWindow({
      x: r.x - OUTLINE_GAP, y: r.y - OUTLINE_GAP, width: r.width + 2 * OUTLINE_GAP, height: r.height + 2 * OUTLINE_GAP,
      transparent: true, focusable: false, alwaysOnTop: true, enableLargerThanScreen: true,
    });
    outline.setIgnoreMouseEvents(true);
    outline.loadURL(page('rec-ui.html#outline'));
    ui.push(outline);
    const below = r.y + r.height + OUTLINE_GAP + BAR.gap;
    const above = r.y - OUTLINE_GAP - BAR.gap - BAR.height;
    const y = below + BAR.height <= area.y + area.height ? below
      : above >= area.y ? above
      : r.y + r.height - BAR.height - BAR.gap; // no room outside: inside, still not recorded
    bar = { x: Math.max(area.x + 8, Math.min(r.x, area.x + area.width - BAR.width - 8)), y };
  } else {
    bar = { x: area.x + Math.round((area.width - BAR.width) / 2), y: area.y + area.height - BAR.height - 16 };
  }
  ui.push(createWindow({ ...bar, width: BAR.width, height: BAR.height, transparent: true, focusable: false, alwaysOnTop: true }));
  ui.at(-1).loadURL(page('rec-ui.html#bar'));
  for (const win of ui) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.once('ready-to-show', () => win.showInactive());
  }
  recording.ui = ui;
}

ipcMain.on('rec-ui-action', (event, action) => {
  if (!recording?.ui.some((win) => win.webContents === event.sender)) return;
  stopRecording(action === 'discard');
});

app.on('before-quit', (event) => {
  if (!recording || quitting) return;
  event.preventDefault(); // save the recording first
  quitting = true;
  stopRecording(false);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
