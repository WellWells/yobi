/**
 * The overlay each display shows while the user boxes a region: the frozen screenshot, dimmed,
 * with the box cut out of the dimming and its size in physical pixels beside it.
 *
 * The page is markup and style only, loaded as a data: URL, and its CSP allows no script at all.
 * Its behaviour is REGION_OVERLAY_SCRIPT, injected by main with executeJavaScript (which a page
 * CSP does not govern), so the overlay needs no preload, no IPC and no renderer bundle entry.
 * Browser-side code: no `??`, no `?.`, no node: imports.
 */

const OVERLAY_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: crosshair; user-select: none; -webkit-user-select: none; }
#shot { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; display: block; pointer-events: none; -webkit-user-drag: none; }
#dim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); pointer-events: none; }
#box { position: fixed; display: none; pointer-events: none; outline: 1px solid rgba(255, 255, 255, 0.95); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 0 100000px rgba(0, 0, 0, 0.45); }
#size, #hint { position: fixed; pointer-events: none; color: #fff; background: rgba(0, 0, 0, 0.72); border-radius: 4px; font: 12px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
#size { display: none; padding: 1px 6px; }
#hint { left: 50%; top: 24px; transform: translateX(-50%); padding: 4px 10px; }
</style></head>
<body><img id="shot" alt=""><div id="dim"></div><div id="box"></div><div id="size"></div><div id="hint"></div></body></html>`;

export const REGION_OVERLAY_URL = `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`;

/** Must match MIN_SELECTION_DIP in geometry.ts; main re-checks every rectangle the page reports. */
export const REGION_OVERLAY_SCRIPT = `(function () {
  if (window.__yobiRegion) return;
  var MIN = 4;
  var shot = document.getElementById('shot');
  var dim = document.getElementById('dim');
  var box = document.getElementById('box');
  var size = document.getElementById('size');
  var hint = document.getElementById('hint');
  var scale = 1;
  var start = null;
  var rect = null;
  var settle = null;

  function viewport() { return { width: window.innerWidth, height: window.innerHeight }; }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function spanOf(a, b) {
    var vp = viewport();
    var x1 = clamp(Math.min(a.x, b.x), 0, vp.width);
    var y1 = clamp(Math.min(a.y, b.y), 0, vp.height);
    var x2 = clamp(Math.max(a.x, b.x), 0, vp.width);
    var y2 = clamp(Math.max(a.y, b.y), 0, vp.height);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function usable(r) { return !!r && r.width >= MIN && r.height >= MIN; }

  function finish(result) {
    if (!settle) return;
    var done = settle;
    settle = null;
    start = null;
    done(result);
  }

  function draw() {
    if (!rect) {
      box.style.display = 'none';
      size.style.display = 'none';
      dim.style.display = 'block';
      return;
    }
    dim.style.display = 'none';
    box.style.display = 'block';
    box.style.left = rect.x + 'px';
    box.style.top = rect.y + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    size.textContent = Math.round(rect.width * scale) + ' \\u00d7 ' + Math.round(rect.height * scale);
    size.style.display = 'block';
    var labelTop = rect.y - 24 >= 0 ? rect.y - 24 : rect.y + rect.height + 6;
    size.style.left = rect.x + 'px';
    size.style.top = labelTop + 'px';
  }

  function point(event) { return { x: event.clientX, y: event.clientY }; }

  window.addEventListener('mousedown', function (event) {
    if (!settle) return;
    event.preventDefault();
    if (event.button === 2) { finish({ kind: 'cancel' }); return; }
    if (event.button !== 0) return;
    start = point(event);
    rect = null;
    hint.style.display = 'none';
    draw();
  }, true);

  window.addEventListener('mousemove', function (event) {
    if (!settle || !start) return;
    rect = spanOf(start, point(event));
    draw();
  }, true);

  window.addEventListener('mouseup', function (event) {
    if (!settle || !start || event.button !== 0) return;
    rect = spanOf(start, point(event));
    start = null;
    if (usable(rect)) { finish({ kind: 'select', rect: rect, viewport: viewport() }); return; }
    rect = null;
    hint.style.display = 'block';
    draw();
  }, true);

  window.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    finish({ kind: 'cancel' });
  }, true);

  window.addEventListener('keydown', function (event) {
    if (!settle) return;
    if (event.key === 'Escape') { event.preventDefault(); finish({ kind: 'cancel' }); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    var vp = viewport();
    var chosen = usable(rect) ? rect : { x: 0, y: 0, width: vp.width, height: vp.height };
    finish({ kind: 'select', rect: chosen, viewport: vp });
  }, true);

  window.addEventListener('dragstart', function (event) { event.preventDefault(); }, true);

  window.__yobiRegion = {
    prepare: function (payload) {
      scale = payload.scaleFactor > 0 ? payload.scaleFactor : 1;
      hint.textContent = payload.hint || '';
      hint.style.display = payload.hint ? 'block' : 'none';
      rect = null;
      start = null;
      draw();
      return new Promise(function (resolve) {
        shot.onload = function () {
          var decoded = shot.decode ? shot.decode() : Promise.resolve();
          decoded.then(function () { resolve(true); }, function () { resolve(true); });
        };
        shot.onerror = function () { resolve(false); };
        shot.src = payload.image;
      });
    },
    result: function () {
      return new Promise(function (resolve) {
        settle = resolve;
      });
    },
    cancel: function () { finish({ kind: 'cancel' }); },
  };
})();`;

export interface OverlayPayload {
  /** The display's frozen picture, as a data: URL. */
  image: string;
  scaleFactor: number;
  hint: string;
}

export type OverlayAnswer =
  | { kind: 'cancel' }
  | { kind: 'select'; rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number } };

/** A page's answer, checked: it is a renderer talking, so its shape is not trusted. */
export function parseOverlayAnswer(raw: unknown): OverlayAnswer {
  if (!raw || typeof raw !== 'object') return { kind: 'cancel' };
  const answer = raw as Record<string, unknown>;
  if (answer.kind !== 'select') return { kind: 'cancel' };
  const rect = answer.rect as Record<string, unknown> | undefined;
  const viewport = answer.viewport as Record<string, unknown> | undefined;
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN);
  const parsed = {
    rect: { x: num(rect?.x), y: num(rect?.y), width: num(rect?.width), height: num(rect?.height) },
    viewport: { width: num(viewport?.width), height: num(viewport?.height) },
  };
  const values = [...Object.values(parsed.rect), ...Object.values(parsed.viewport)];
  if (values.some((value) => Number.isNaN(value))) return { kind: 'cancel' };
  return { kind: 'select', ...parsed };
}
