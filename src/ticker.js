// Steady ~30 Hz clock for the recorder's compositor. The offscreen document is
// never visible, so its own timers may be throttled; worker timers are not.
setInterval(() => postMessage(0), 33);
