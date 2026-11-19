import { useCallback, useState } from 'react';
import type React from 'react';

/**
 * Which row of a sidebar tree is its one Tab stop (WCAG 2.4.3: a long list is one stop, the arrows
 * walk it, as Explorer's navigation pane): the row the keyboard or a click last focused while it
 * is still drawn; else the open item (conversation, knowledge base, flow); else the first row.
 */
export function pickTabKey(keys: readonly string[], last: string | null, preferred: string | null): string | null {
  if (last !== null && keys.includes(last)) return last;
  if (preferred !== null && keys.includes(preferred)) return preferred;
  return keys[0] ?? null;
}

/** How many frames a jump into a virtual list waits for the row to be drawn before giving up. */
const FOCUS_ATTEMPTS = 4;

/** Focus the row of `key` once it is drawn (a virtual list draws it a frame or two after the scroll). */
export function focusRowWhenDrawn(find: (key: string) => HTMLElement | null | undefined, key: string): void {
  let attempts = 0;
  const tryFocus = (): void => {
    const node = find(key);
    if (node) {
      node.focus();
      return;
    }
    attempts += 1;
    if (attempts < FOCUS_ATTEMPTS) window.requestAnimationFrame(tryFocus);
  };
  window.requestAnimationFrame(tryFocus);
}

interface RovingRow {
  /** The row key that carries `tabIndex` 0 (null = an empty list). */
  tabKey: string | null;
  /** The tree's focus-in: remembers which row now has focus (`keyOf` maps an element to its row key). */
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
}

/** The roving Tab stop of one sidebar tree. */
export function useRovingRow(
  keys: readonly string[],
  preferred: string | null,
  keyOf: (node: Element) => string | null,
): RovingRow {
  const [last, setLast] = useState<string | null>(null);
  const onFocus = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const key = keyOf(e.target);
    if (key !== null) setLast((current) => (current === key ? current : key));
  }, [keyOf]);
  return { tabKey: pickTabKey(keys, last, preferred), onFocus };
}
