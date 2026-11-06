// Functions injected into the captured page via
// chrome.scripting.executeScript({ func }). Chrome serializes each function's
// source, so every function here must be self-contained: no imports and no
// references to module-level names. Shared state lives on window.__snapstitch
// in the extension's isolated world, which persists between injections.

// Freezes the page for a scrolling capture and returns its metrics in CSS px.
export function prepareFullPage(maxHeight) {
  window.__snapstitch?.restore();

  const scroller = document.scrollingElement || document.documentElement;
  const { scrollX, scrollY } = window;
  const saved = [];
  const state = {
    hidden: new Set(),
    override(el, prop, value) {
      saved.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
      el.style.setProperty(prop, value, 'important');
    },
    restore() {
      window.__snapstitch = undefined;
      // Scroll back before re-enabling any smooth scroll-behavior.
      window.scrollTo(scrollX, scrollY);
      for (const [el, prop, value, priority] of saved.reverse()) {
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
    },
  };
  window.__snapstitch = state;

  state.override(document.documentElement, 'scroll-behavior', 'auto');
  if (document.body) state.override(document.body, 'scroll-behavior', 'auto');

  // A sticky element that isn't stuck is laid out exactly like a relative one
  // with auto offsets. Pinning it there keeps sticky headers from repeating on
  // every tile without removing them from the image.
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).position !== 'sticky') continue;
    state.override(el, 'position', 'relative');
    for (const side of ['top', 'right', 'bottom', 'left']) state.override(el, side, 'auto');
  }

  return {
    totalW: scroller.scrollWidth,
    totalH: Math.min(maxHeight, scroller.scrollHeight),
    viewW: scroller.clientWidth,
    viewH: scroller.clientHeight,
    innerWidth: window.innerWidth,
  };
}

// Scrolls to a tile and waits for it to paint. Returns the real scroll
// position, which the browser clamps for the last row/column.
export async function scrollToTile(x, y, hideFixed) {
  const state = window.__snapstitch;
  window.scrollTo(x, y);

  // Fixed elements (floating headers, chat buttons) belong to the first tile
  // only. Re-scanned per tile because some sites only go fixed after scrolling.
  if (hideFixed && state) {
    for (const el of document.querySelectorAll('body *')) {
      if (state.hidden.has(el) || getComputedStyle(el).position !== 'fixed') continue;
      state.hidden.add(el);
      state.override(el, 'visibility', 'hidden');
    }
  }

  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
    setTimeout(resolve, 250); // rAF never fires if the tab gets hidden
  });
  return { x: window.scrollX, y: window.scrollY };
}

export function restoreFullPage() {
  window.__snapstitch?.restore();
}
