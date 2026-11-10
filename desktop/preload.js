// Gives the app's own pages (served from snapstitch://app/desktop/) a way to
// talk to main.js. No remote content is ever loaded: main.js blocks the network.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapstitch', {
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, fn) => ipcRenderer.on(channel, (event, ...args) => fn(...args)),
});
