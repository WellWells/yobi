/*
 * Where the selection bar goes, and how tall it may get. Folded, it sits just above the selection
 * (below when there is no room). Unfolded (the writing tools, a translation), it needs height: it
 * goes below or above when one of them holds all of it; else it stays against the selection's
 * edge on the side with more room and moves over the selection as far as it must — always next to
 * the text, never squeezed into the strip a tall selection leaves above or below it.
 */

export interface PlacementRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/** The area the bar must stay inside: the conversation's scroll area, not the window (the title bar is above it). */
export interface PlacementBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type PlacementSide = 'above' | 'below' | 'over';

export interface Placement {
  side: PlacementSide;
  left: number;
  /** For `above` the bar's bottom edge (it is drawn translated up by its own height); else its top. */
  top: number;
  maxHeight: number;
}

export const PLACEMENT_EDGE = 12;
export const PLACEMENT_GAP = 10;
/** A folded bar, or a cramped one, is never capped below this. */
export const PLACEMENT_MIN_HEIGHT = 152;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function placeSelectionBar(args: {
  rect: PlacementRect;
  bounds: PlacementBounds;
  /** The bar's width (measured, or its expected width before the first measure). */
  width: number;
  /** The height it wants: the row, plus the unfolded panel's. */
  height: number;
  /** A panel is unfolded: height matters more than staying off the selection. */
  unfolded: boolean;
}): Placement {
  const { rect, bounds, height, unfolded } = args;
  const inner = {
    top: bounds.top + PLACEMENT_EDGE,
    bottom: bounds.bottom - PLACEMENT_EDGE,
    left: bounds.left + PLACEMENT_EDGE,
    right: bounds.right - PLACEMENT_EDGE,
  };
  const width = Math.min(args.width, inner.right - inner.left);
  const centred = clamp(rect.left + rect.width / 2 - width / 2, inner.left, inner.right - width);
  const roomAbove = rect.top - PLACEMENT_GAP - inner.top;
  const roomBelow = inner.bottom - (rect.bottom + PLACEMENT_GAP);
  const full = Math.max(inner.bottom - inner.top, PLACEMENT_MIN_HEIGHT);

  if (!unfolded) {
    // Folded: above the selection where it fits, so the bar does not cover the next lines.
    const above = roomAbove >= height || roomAbove > roomBelow;
    return above
      ? { side: 'above', left: centred, top: Math.max(rect.top - PLACEMENT_GAP, inner.top + height), maxHeight: Math.max(roomAbove, PLACEMENT_MIN_HEIGHT) }
      : { side: 'below', left: centred, top: Math.min(rect.bottom + PLACEMENT_GAP, inner.bottom - height), maxHeight: Math.max(roomBelow, PLACEMENT_MIN_HEIGHT) };
  }

  if (roomBelow >= height) return { side: 'below', left: centred, top: rect.bottom + PLACEMENT_GAP, maxHeight: roomBelow };
  if (roomAbove >= height) return { side: 'above', left: centred, top: rect.top - PLACEMENT_GAP, maxHeight: roomAbove };

  // Neither side holds it (a tall selection): it stays by the selection, on the side with more
  // room, against the selection's edge, and moves over the selection as far as its height needs.
  // Not out in the margin: a panel away from the text it acts on reads as unrelated.
  const tall = Math.min(height, full);
  const top = roomBelow >= roomAbove
    ? clamp(rect.bottom + PLACEMENT_GAP, inner.top, inner.bottom - tall)
    : clamp(rect.top - PLACEMENT_GAP - tall, inner.top, inner.bottom - tall);
  return { side: 'over', left: centred, top, maxHeight: full };
}
