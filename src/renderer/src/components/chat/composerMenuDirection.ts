import type { CSSProperties } from 'react';
import type { FloatingPosition } from '@mantine/core';

/**
 * Which way the composer's menus open. Docked at the bottom edge the only room is above it; on
 * an empty chat the composer sits under the greeting and the room is below, so opening upward
 * would cover the greeting while the space under the composer stays empty.
 */
export type MenuDirection = 'up' | 'down';

/** The composer's menu direction for its current layout. */
export function composerMenuDirection(centered: boolean): MenuDirection {
  return centered ? 'down' : 'up';
}

/** Mantine position for a menu that hangs off one end of its trigger. */
export function composerMenuPosition(direction: MenuDirection, align: 'start' | 'end'): FloatingPosition {
  return `${direction === 'up' ? 'top' : 'bottom'}-${align}`;
}

const SUGGEST_GAP = 6;
/** Breathing room kept between the list and the window edge. */
const SUGGEST_EDGE_MARGIN = 8;
/** Below this the list stops shrinking: a scrollable four rows beats an unreadable sliver. */
export const SUGGEST_MIN_HEIGHT = 160;
export const SUGGEST_MAX_HEIGHT = 320;

/** Edge offsets for the absolutely positioned slash-command / `/model` list. */
export function suggestListEdge(direction: MenuDirection): CSSProperties {
  return direction === 'up'
    ? { bottom: '100%', marginBottom: SUGGEST_GAP }
    : { top: '100%', marginTop: SUGGEST_GAP };
}

/**
 * Height the list may take on its side of the composer. It is positioned by hand rather than by
 * the floating layer, so nothing else keeps it inside the window.
 */
export function suggestListMaxHeight(
  direction: MenuDirection,
  anchor: { top: number; bottom: number },
  viewportHeight: number,
): number {
  const room = direction === 'up'
    ? anchor.top - SUGGEST_GAP - SUGGEST_EDGE_MARGIN
    : viewportHeight - anchor.bottom - SUGGEST_GAP - SUGGEST_EDGE_MARGIN;
  return Math.max(SUGGEST_MIN_HEIGHT, Math.min(SUGGEST_MAX_HEIGHT, Math.floor(room)));
}
