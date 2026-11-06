// In-page side of a recording, injected when it starts. Reports the pointer to
// the recorder, which draws the cursor into the video (tab capture can't see
// the real one). For area recordings it also outlines the area and shows a
// Stop bar, both placed outside the area so they never appear in the video.
// Removes itself when the recorder disconnects the port.
(() => {
  if (window.__snapstitchRecUi) return;
  window.__snapstitchRecUi = true;
  const area = window.__snapstitchRecArea;
  const port = chrome.runtime.connect({ name: 'snapstitch-cursor' });

  let pending = null;
  let frame = 0;
  function onMove(e) {
    pending = { x: e.clientX, y: e.clientY };
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      port.postMessage(pending);
    });
  }
  const onDown = (e) => port.postMessage({ x: e.clientX, y: e.clientY, click: true });
  const onLeave = () => port.postMessage({ hidden: true });

  const opts = { capture: true, passive: true };
  addEventListener('pointermove', onMove, opts);
  addEventListener('pointerdown', onDown, opts);
  document.documentElement.addEventListener('mouseleave', onLeave);

  let timer = 0;
  const host = area && buildAreaUi(area);

  port.onDisconnect.addListener(() => {
    removeEventListener('pointermove', onMove, opts);
    removeEventListener('pointerdown', onDown, opts);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    cancelAnimationFrame(frame);
    clearInterval(timer);
    host?.remove();
    window.__snapstitchRecUi = false;
  });

  function buildAreaUi(r) {
    const BAR_H = 36;
    const GAP = 12;
    // The outline's inner edge sits 4px outside the area: capture frames can be
    // scaled by up to ~3px across the screen (docs/chrome-notes.md), and a
    // tighter outline would bleed into the recording.
    const OUT = 6;
    const barTop = r.y + r.height + GAP + BAR_H <= innerHeight ? r.y + r.height + GAP
      : r.y - GAP - BAR_H >= 0 ? r.y - GAP - BAR_H
      : null; // no room outside the area; a bar inside would be recorded
    const el = document.createElement('div');
    el.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = el.attachShadow({ mode: 'open' }); // open so tests can press Stop
    root.innerHTML = `
      <style>
        .frame {
          position: fixed; box-sizing: border-box; border: 2px dashed #ef4444;
          left: ${r.x - OUT}px; top: ${r.y - OUT}px; width: ${r.width + 2 * OUT}px; height: ${r.height + 2 * OUT}px;
        }
        .bar {
          position: fixed; left: ${Math.max(8, Math.min(r.x, innerWidth - 230))}px; top: ${barTop}px;
          height: ${BAR_H}px; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 12px;
          box-sizing: border-box; border-radius: 8px; background: rgba(17, 17, 17, .9); color: #fff;
          font: 13px/1 system-ui, sans-serif; pointer-events: auto; box-shadow: 0 2px 10px rgba(0, 0, 0, .3);
        }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #ef4444; animation: blink 1s steps(1) infinite; }
        @keyframes blink { 50% { opacity: .3; } }
        .time { font-variant-numeric: tabular-nums; min-width: 34px; }
        button {
          height: 26px; padding: 0 10px; border: 0; border-radius: 5px; cursor: pointer;
          font: 600 12px/1 system-ui, sans-serif; color: #fff; background: #dc2626;
        }
        button:hover { background: #b91c1c; }
        .cancel { background: transparent; color: #d1d5db; padding: 0 8px; }
        .cancel:hover { background: rgba(255, 255, 255, .12); }
      </style>
      <div class="frame"></div>
      ${barTop === null ? '' : `
        <div class="bar">
          <span class="dot"></span><span class="time">0:00</span>
          <button class="stop">&#9632; Stop</button>
          <button class="cancel" title="Discard recording">&#10005;</button>
        </div>`}`;
    const time = root.querySelector('.time');
    if (time) {
      const started = Date.now();
      timer = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 1000);
      root.querySelector('.stop').onclick = () => chrome.runtime.sendMessage({ type: 'record-stop' });
      root.querySelector('.cancel').onclick = () => chrome.runtime.sendMessage({ type: 'record-cancel' });
    }
    document.documentElement.appendChild(el);
    return el;
  }
})();
