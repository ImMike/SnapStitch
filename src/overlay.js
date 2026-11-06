// Region selector, injected on demand. Lets the user drag a rectangle, then
// removes itself and reports the rectangle (viewport CSS px) to the service
// worker, which takes a screenshot or starts recording, per the purpose the
// worker set in window.__snapstitchOverlayPurpose before injecting this.
(() => {
  if (window.__snapstitchOverlay) return;
  window.__snapstitchOverlay = true;
  const purpose = window.__snapstitchOverlayPurpose || 'screenshot';

  const host = document.createElement('div');
  host.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .shade { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); }
      .box {
        position: fixed; display: none;
        outline: 1px solid #fff;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, .5), 0 0 0 100vmax rgba(0, 0, 0, .35);
      }
      .label, .hint {
        position: fixed; pointer-events: none;
        font: 12px/1.2 system-ui, sans-serif; color: #fff;
        background: rgba(17, 17, 17, .85); border-radius: 4px; padding: 4px 7px;
      }
      .label { display: none; }
      .hint { top: 16px; left: 50%; transform: translateX(-50%); font-size: 13px; padding: 7px 12px; }
    </style>
    <div class="shade"></div>
    <div class="box"></div>
    <div class="label"></div>
    <div class="hint">Drag to ${purpose === 'record' ? 'record' : 'capture'} &middot; Esc to cancel</div>`;
  const [shade, box, label, hint] = root.querySelectorAll('div');

  let start = null;
  let rect = null;

  function clamp(v, max) {
    return Math.max(0, Math.min(v, max));
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    start = { x: clamp(e.clientX, innerWidth), y: clamp(e.clientY, innerHeight) };
    shade.style.display = hint.style.display = 'none';
    box.style.display = label.style.display = 'block';
    onMove(e);
  }

  function onMove(e) {
    if (!start) return;
    const x = clamp(e.clientX, innerWidth);
    const y = clamp(e.clientY, innerHeight);
    rect = {
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    };
    Object.assign(box.style, {
      left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
    label.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    const below = rect.y + rect.height + 28 < innerHeight;
    label.style.left = `${rect.x}px`;
    label.style.top = `${below ? rect.y + rect.height + 6 : Math.max(4, rect.y - 26)}px`;
  }

  function onUp() {
    if (!start) return;
    const selected = rect;
    close();
    if (!selected || selected.width < 4 || selected.height < 4) return;
    // Let a frame without the overlay reach the screen before capturing.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        chrome.runtime.sendMessage({ type: 'region', purpose, rect: selected, innerWidth })));
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  const block = (e) => e.preventDefault();

  function close() {
    host.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', block, { capture: true });
    window.__snapstitchOverlay = false;
  }

  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', block, { capture: true, passive: false });
  document.documentElement.appendChild(host);
})();
