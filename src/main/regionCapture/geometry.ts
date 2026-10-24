/**
 * Coordinates for the screen-region capture. Three spaces meet here:
 *
 * - the virtual desktop in DIPs (Electron's `screen`), where a display left of or above the
 *   primary one has a negative origin;
 * - an overlay window's CSS pixels, which are that display's DIPs with the origin at its corner;
 * - the captured picture's physical pixels, `scaleFactor` times the DIPs (1.25, 1.5, 2 …), and
 *   different per display on a mixed-DPI desk.
 *
 * Pure functions only, so the arithmetic is tested without a screen.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface DisplayLike {
  id: number;
  bounds: Rect;
  scaleFactor: number;
}

/** Anything smaller (in CSS pixels, either side) is a click, not a box. */
export const MIN_SELECTION_DIP = 4;

/** A display's own pixels: what a crop at full resolution is measured in. */
export function physicalSize(display: DisplayLike): Size {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

/**
 * desktopCapturer takes ONE thumbnail size for every screen and fits each picture inside it,
 * keeping its shape. Asking for the widest width and the tallest height lets every display fit
 * at its own native resolution or larger — never smaller — on a mixed-DPI desk.
 */
export function captureRequestSize(displays: readonly DisplayLike[]): Size {
  let width = 1;
  let height = 1;
  for (const display of displays) {
    const size = physicalSize(display);
    width = Math.max(width, size.width);
    height = Math.max(height, size.height);
  }
  return { width, height };
}

/**
 * The size a captured picture should be brought to, or null when it already is the display's
 * own: the shared thumbnail size above blows a smaller display's picture up, and those extra
 * pixels are only interpolation.
 */
export function downscaleTarget(image: Size, display: DisplayLike): Size | null {
  const native = physicalSize(display);
  if (image.width <= native.width + 1 && image.height <= native.height + 1) return null;
  return native;
}

/** The display a virtual-desktop point is on; the nearest one when it is in a gap between them. */
export function displayAtPoint<D extends DisplayLike>(displays: readonly D[], point: Point): D | undefined {
  let nearest: D | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const { x, y, width, height } = display.bounds;
    const dx = point.x < x ? x - point.x : point.x >= x + width ? point.x - (x + width - 1) : 0;
    const dy = point.y < y ? y - point.y : point.y >= y + height ? point.y - (y + height - 1) : 0;
    const distance = dx * dx + dy * dy;
    if (distance === 0) return display;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = display;
    }
  }
  return nearest;
}

/** A virtual-desktop rectangle in the display's own coordinates (origin at its top-left corner). */
export function toDisplayLocal(rect: Rect, display: DisplayLike): Rect {
  return { ...rect, x: rect.x - display.bounds.x, y: rect.y - display.bounds.y };
}

/** The box a drag spans, whichever way the mouse went. */
export function rectFromDrag(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Cut to the area `[0, 0, area.width, area.height]`; an empty or non-finite box comes back 0×0. */
export function clampToArea(rect: Rect, area: Size): Rect {
  const finite = [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
  if (!finite) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(Math.max(rect.x, 0), area.width);
  const top = Math.min(Math.max(rect.y, 0), area.height);
  const right = Math.min(Math.max(rect.x + rect.width, 0), area.width);
  const bottom = Math.min(Math.max(rect.y + rect.height, 0), area.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function isUsableSelection(rect: Rect): boolean {
  return rect.width >= MIN_SELECTION_DIP && rect.height >= MIN_SELECTION_DIP;
}

/**
 * The selection (CSS pixels of the overlay, whose `viewport` the picture fills edge to edge) as
 * a crop of the captured picture, in its pixels. Measured as a fraction of the viewport rather
 * than multiplied by `scaleFactor`: a window Windows sized a little off on a mixed-DPI desk still
 * crops exactly what the user saw. Edges round outward so a boxed line of text is never shaved.
 * Null when nothing usable is left after clamping to the display.
 */
export function cropRectInImage(selection: Rect, viewport: Size, image: Size): Rect | null {
  if (!(viewport.width > 0 && viewport.height > 0 && image.width > 0 && image.height > 0)) return null;
  const clamped = clampToArea(selection, viewport);
  if (!isUsableSelection(clamped)) return null;
  const sx = image.width / viewport.width;
  const sy = image.height / viewport.height;
  const left = Math.max(0, Math.floor(clamped.x * sx));
  const top = Math.max(0, Math.floor(clamped.y * sy));
  const right = Math.min(image.width, Math.ceil((clamped.x + clamped.width) * sx));
  const bottom = Math.min(image.height, Math.ceil((clamped.y + clamped.height) * sy));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Pairs each display with its desktopCapturer source. `display_id` is the reliable key; some
 * Linux setups leave it empty, and then the sources come in the displays' order.
 */
export function matchSourcesToDisplays<S extends { display_id: string }, D extends DisplayLike>(
  sources: readonly S[],
  displays: readonly D[],
): Array<{ display: D; source: S }> {
  const byId = new Map(sources.filter((source) => source.display_id).map((source) => [source.display_id, source]));
  const pairs: Array<{ display: D; source: S }> = [];
  displays.forEach((display, index) => {
    const source = byId.get(String(display.id)) ?? (byId.size === 0 ? sources[index] : undefined);
    if (source) pairs.push({ display, source });
  });
  return pairs;
}
