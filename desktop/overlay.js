// Area selector for one display, on a frozen screenshot of it (main.js shows
// one per display). Same look and handling as the extension's src/overlay.js.
// Reports the rectangle in CSS px of this display.
const api = window.snapstitch;
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const [shade, box, label, hint] = document.querySelectorAll('div');

let start = null;
let rect = null;

api.on('overlay-show', ({ purpose, width, height, bitmap, hint: showHint }) => {
  // Paint the frozen screen 1:1 in device pixels (bitmap is BGRA).
  canvas.width = width;
  canvas.height = height;
  const rgba = new Uint8ClampedArray(bitmap.buffer ?? bitmap, bitmap.byteOffset ?? 0, width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const b = rgba[i];
    rgba[i] = rgba[i + 2];
    rgba[i + 2] = b;
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  hint.textContent = `Drag to ${purpose === 'record' ? 'record' : 'capture'} · Esc to cancel`;
  hint.hidden = !showHint;
  reset();
});

api.on('overlay-hide', () => {
  reset();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

function reset() {
  start = rect = null;
  shade.style.display = '';
  box.style.display = label.style.display = 'none';
}

const clamp = (v, max) => Math.max(0, Math.min(v, max));

addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  document.body.setPointerCapture(e.pointerId);
  start = { x: clamp(e.clientX, innerWidth), y: clamp(e.clientY, innerHeight) };
  shade.style.display = 'none';
  hint.hidden = true;
  box.style.display = label.style.display = 'block';
  onMove(e);
});

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
  label.textContent = `${Math.round(rect.width * devicePixelRatio)} × ${Math.round(rect.height * devicePixelRatio)}`;
  const below = rect.y + rect.height + 28 < innerHeight;
  label.style.left = `${rect.x}px`;
  label.style.top = `${below ? rect.y + rect.height + 6 : Math.max(4, rect.y - 26)}px`;
}
addEventListener('pointermove', onMove);

addEventListener('pointerup', () => {
  if (!start) return;
  const selected = rect;
  start = null;
  if (!selected || selected.width < 4 || selected.height < 4) {
    reset();
    return;
  }
  api.send('overlay-select', selected);
});

addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.send('overlay-cancel');
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.send('overlay-cancel');
});
