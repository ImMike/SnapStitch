// #outline: the dashed frame around a recorded area. #bar: the Stop bar.
// Both windows are kept out of the video (content protection) by main.js.
const api = window.snapstitch;
const part = location.hash.slice(1);

document.querySelector(part === 'outline' ? '.frame' : '.bar').hidden = false;
if (part === 'bar') {
  api.on('rec-ui-time', (text) => (document.querySelector('.time').textContent = text));
  document.querySelector('.stop').onclick = () => api.send('rec-ui-action', 'stop');
  document.querySelector('.cancel').onclick = () => api.send('rec-ui-action', 'discard');
}
