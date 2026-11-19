/**
 * The file list's selection, as a system file manager's (Windows Explorer, Finder's list view):
 * a click selects that row alone, Ctrl/⌘+click adds or removes one, Shift+click selects the range
 * from the anchor (Ctrl/⌘+Shift adds it), the arrows move and select (Shift extends, Ctrl/⌘ moves
 * the focus only), and a right-click on a row outside the selection selects that row first.
 * `order` is the rows as drawn (filtered and sorted).
 */
export interface KbSelection {
  selected: ReadonlySet<string>;
  /** Where a Shift range starts: the last row clicked or moved to without Shift. */
  anchor: string | null;
  /** The keyboard's row (the one Tab lands on). */
  focus: string | null;
}

export interface SelectMods {
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  toggle: boolean;
  range: boolean;
}

export type ListMove = 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown';

export const EMPTY_SELECTION: KbSelection = { selected: new Set(), anchor: null, focus: null };

function rangeOf(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function liveAnchor(state: KbSelection, order: readonly string[]): string | null {
  return state.anchor !== null && order.includes(state.anchor) ? state.anchor : null;
}

/** A click on a row (or Space on the focused one). */
export function clickSelect(state: KbSelection, rel: string, mods: SelectMods, order: readonly string[]): KbSelection {
  const anchor = liveAnchor(state, order);
  if (mods.range && anchor !== null) {
    const range = rangeOf(order, anchor, rel);
    return { selected: new Set(mods.toggle ? [...state.selected, ...range] : range), anchor, focus: rel };
  }
  if (mods.toggle) {
    const selected = new Set(state.selected);
    if (selected.has(rel)) selected.delete(rel);
    else selected.add(rel);
    return { selected, anchor: rel, focus: rel };
  }
  return { selected: new Set([rel]), anchor: rel, focus: rel };
}

/** An arrow, Home/End or Page key on the list. Null when there is nothing to move to. */
export function moveSelect(state: KbSelection, move: ListMove, mods: SelectMods, order: readonly string[], page: number): KbSelection | null {
  if (order.length === 0) return null;
  const at = state.focus === null ? -1 : order.indexOf(state.focus);
  const step = Math.max(1, page);
  const wanted = {
    up: at < 0 ? 0 : at - 1,
    down: at < 0 ? 0 : at + 1,
    home: 0,
    end: order.length - 1,
    pageUp: at < 0 ? 0 : at - step,
    pageDown: at < 0 ? 0 : at + step,
  }[move];
  const rel = order[Math.min(order.length - 1, Math.max(0, wanted))] ?? '';
  if (mods.range) {
    const anchor = liveAnchor(state, order) ?? (at >= 0 ? order[at] ?? rel : rel);
    const range = rangeOf(order, anchor, rel);
    return { selected: new Set(mods.toggle ? [...state.selected, ...range] : range), anchor, focus: rel };
  }
  if (mods.toggle) return { ...state, focus: rel };
  return { selected: new Set([rel]), anchor: rel, focus: rel };
}

/** A right-click: inside the selection it acts on all of it; outside, that row becomes the selection. */
export function contextSelect(state: KbSelection, rel: string): KbSelection {
  if (state.selected.has(rel)) return { ...state, focus: rel };
  return { selected: new Set([rel]), anchor: rel, focus: rel };
}

/** The selected rows in the order they are drawn (what a batch action lists and acts on). */
export function selectedInOrder(selected: ReadonlySet<string>, order: readonly string[]): string[] {
  return order.filter((rel) => selected.has(rel));
}

const FOCUS_ONLY_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/**
 * Whether a key on a row reaches the list's selection at all. Tab (and a modifier pressed alone, as
 * Shift before Shift+Tab) only moves focus: entering or leaving the list shows the focus cue on the
 * row and never changes what is selected, as in Explorer (WCAG 3.2.1 On Focus).
 */
export function rowKeyReachesList(key: string): boolean {
  return !FOCUS_ONLY_KEYS.has(key);
}

/** The list's key, or null when the key is not one of the list's own. */
export function listMoveOf(key: string): ListMove | null {
  switch (key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'Home': return 'home';
    case 'End': return 'end';
    case 'PageUp': return 'pageUp';
    case 'PageDown': return 'pageDown';
    default: return null;
  }
}
