/**
 * The arithmetic of the media viewer, modelled on Telegram Desktop's: media larger than the room
 * opens fitted, smaller media opens at its own size (never blown up); zoom moves through whole
 * steps — 1/8 … 1/2, 1×, 2× … 8× with "fit" slotted in where it falls — around the pointer; a
 * zoomed photo pans but never leaves a gap on an axis it overflows.
 */

export interface Size { w: number; h: number }
export interface Point { x: number; y: number }

/** A step on the scale, or the scale that fits the room. */
export type Zoom = number | 'fit';

const MAX_ZOOM_LEVEL = 7;

/** One wheel notch. Chromium reports about 100 per notch; finer devices add up to it. */
export const WHEEL_STEP = 100;

export function levelScale(level: number): number {
  return level >= 0 ? level + 1 : 1 / (1 - level);
}

export function fitScale(natural: Size, room: Size): number {
  if (natural.w <= 0 || natural.h <= 0 || room.w <= 0 || room.h <= 0) return 1;
  return Math.min(room.w / natural.w, room.h / natural.h);
}

export function initialZoom(natural: Size, room: Size): Zoom {
  return natural.w > room.w || natural.h > room.h ? 'fit' : 0;
}

export function zoomScale(zoom: Zoom, fit: number): number {
  return zoom === 'fit' ? fit : levelScale(zoom);
}

/** The next step up (`1`) or down (`-1`); stays put at either end. */
export function stepZoom(zoom: Zoom, fit: number, direction: 1 | -1): Zoom {
  const stops: Zoom[] = [];
  for (let level = -MAX_ZOOM_LEVEL; level <= MAX_ZOOM_LEVEL; level++) stops.push(level);
  // A fit that equals a step is that step, not a second stop at the same scale.
  if (!stops.some((stop) => zoomScale(stop, fit) === fit)) stops.push('fit');
  stops.sort((a, b) => zoomScale(a, fit) - zoomScale(b, fit));
  const scale = zoomScale(zoom, fit);
  const current = stops.findIndex((stop) => zoomScale(stop, fit) === scale);
  return stops[Math.min(stops.length - 1, Math.max(0, current + direction))];
}

/** Middle click: the media's own size, or fitted when it already is. */
export function toggleZoom(zoom: Zoom): Zoom {
  return zoom === 0 ? 'fit' : 0;
}

/** Keeps a pan inside the media: centred on an axis that fits, no gap on one that overflows. */
export function clampOffset(offset: Point, shown: Size, room: Size): Point {
  const axis = (value: number, size: number, space: number): number => {
    if (size <= space) return 0;
    const limit = (size - space) / 2;
    return Math.min(limit, Math.max(-limit, value));
  };
  return { x: axis(offset.x, shown.w, room.w), y: axis(offset.y, shown.h, room.h) };
}

/** The pan that keeps the point under `anchor` (relative to the room's centre) where it is. */
export function zoomAt(offset: Point, anchor: Point, fromScale: number, toScale: number): Point {
  const ratio = toScale / fromScale;
  return { x: anchor.x - (anchor.x - offset.x) * ratio, y: anchor.y - (anchor.y - offset.y) * ratio };
}

/**
 * Adds a wheel event to the running total and says how many steps it makes (−1, 0 or 1,
 * down = 1). A mostly sideways scroll starts over; a step spends the whole total, so a
 * notch slightly over 100 never adds up to a second, unasked step.
 */
export function wheelSteps(total: number, deltaX: number, deltaY: number): { total: number; step: -1 | 0 | 1 } {
  if (Math.abs(deltaX) > Math.abs(deltaY)) return { total: 0, step: 0 };
  // Turning the wheel back starts the count over instead of first paying off the other way.
  const sum = total === 0 || Math.sign(total) === Math.sign(deltaY) ? total + deltaY : deltaY;
  if (Math.abs(sum) < WHEEL_STEP) return { total: sum, step: 0 };
  return { total: 0, step: sum > 0 ? 1 : -1 };
}

export type ViewerKeyAction = 'previous' | 'next' | 'playPause' | 'back' | 'forward';

/** What a key does in the viewer; null leaves it to the element or the system. */
export function viewerKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  video: boolean,
): ViewerKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowLeft') return 'previous';
  if (event.key === 'ArrowRight') return 'next';
  if (!video) return null;
  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'k') return 'playPause';
  if (key === 'j') return 'back';
  if (key === 'l') return 'forward';
  return null;
}
