const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

for (const button of document.querySelectorAll('button[data-mode]')) {
  button.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'start', mode: button.dataset.mode, tabId: tab.id });
    window.close();
  });
}

// While recording, the popup becomes the stop control.
const { recording } = await chrome.storage.session.get('recording');
const recorderAlive = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
if (recording && recorderAlive) {
  document.getElementById('idle').hidden = true;
  document.getElementById('recording').hidden = false;
  const elapsed = document.getElementById('elapsed');
  const update = () => {
    const s = Math.floor((Date.now() - recording.startedAt) / 1000);
    elapsed.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  update();
  setInterval(update, 1000);
  for (const [id, type] of [['stop', 'record-stop'], ['discard', 'record-cancel']]) {
    document.getElementById(id).addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type });
      window.close();
    });
  }
  document.getElementById('stop').focus();
}

// Show the live shortcuts, since the user may have rebound them.
for (const { name, shortcut } of await chrome.commands.getAll()) {
  for (const kbd of document.querySelectorAll(`kbd[data-command="${name}"]`)) kbd.textContent = shortcut;
}

document.getElementById('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});
