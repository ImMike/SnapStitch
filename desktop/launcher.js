// The tray icon's popup: the same choices as the extension's popup, for the
// desktop. main.js sends 'launcher-state' each time it's shown.
const api = window.snapstitch;
const $ = (id) => document.getElementById(id);
const KEY_NAMES = { Control: 'Ctrl', PrintScreen: 'PrtSc' };

for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', () => api.send('launcher-action', button.dataset.action));
}
addEventListener('keydown', (e) => e.key === 'Escape' && api.send('launcher-action', 'hide'));

let timer = 0;
function render({ hotkeys, recording, target }) {
  for (const kbd of document.querySelectorAll('kbd[data-hotkey]')) {
    kbd.textContent = (hotkeys[kbd.dataset.hotkey] || '').split('+').map((k) => KEY_NAMES[k] ?? k).join('+');
  }
  $('idle').hidden = Boolean(recording);
  $('recording').hidden = !recording;
  clearInterval(timer);
  if (recording) {
    const update = () => {
      const s = Math.floor((Date.now() - recording.startedAt) / 1000);
      $('elapsed').textContent = recording.stopping ? 'saving…'
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    update();
    timer = setInterval(update, 1000);
  }
  $('target').textContent = target ? `Opens in ${target} · right-click the tray icon for settings`
    : 'SnapStitch extension not found in Chrome, Edge or Brave';
  api.send('launcher-size', document.documentElement.scrollHeight);
  document.querySelector(recording ? '#recording button' : '#idle button').focus();
}

api.on('launcher-state', render);
render(await api.invoke('launcher-state'));
