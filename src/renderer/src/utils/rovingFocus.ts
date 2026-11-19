import type React from 'react';

/**
 * Roving focus inside one composite widget (a nav, a tree, a tab row): the widget is a single Tab
 * stop and the arrows walk its items, as Windows' own lists and navigation panes do (WCAG 2.1.1,
 * 2.4.3; ARIA APG). Only the focus moves here; whoever owns the items decides which one is the
 * Tab stop (`tabIndex` 0, the rest -1) and what Enter does.
 */
export type RovingOrientation = 'vertical' | 'horizontal';

const NEXT: Record<RovingOrientation, string> = { vertical: 'ArrowDown', horizontal: 'ArrowRight' };
const PREV: Record<RovingOrientation, string> = { vertical: 'ArrowUp', horizontal: 'ArrowLeft' };

/** The items a key can land on: drawn ones only (hidden views stay in the DOM). */
export function rovingItems(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((el) => el.getClientRects().length > 0 && !el.hasAttribute('disabled'));
}

/** Where a key moves within `count` items from `index` (-1 = none focused); null = not a walking key. */
export function rovingTarget(key: string, index: number, count: number, orientation: RovingOrientation): number | null {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === NEXT[orientation]) return index < 0 ? 0 : Math.min(count - 1, index + 1);
  if (key === PREV[orientation]) return index < 0 ? 0 : Math.max(0, index - 1);
  return null;
}

/**
 * A keydown on the widget: moves focus to the next, previous, first or last item and reports
 * whether it did. Modified keys (Ctrl, Alt, Meta, Shift) are left to their owners.
 */
export function handleRovingKey(
  e: React.KeyboardEvent<HTMLElement>,
  selector: string,
  orientation: RovingOrientation,
): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return false;
  const items = rovingItems(e.currentTarget, selector);
  const current = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
  const target = rovingTarget(e.key, current, items.length, orientation);
  if (target === null) return false;
  e.preventDefault();
  items[target]?.focus();
  return true;
}
