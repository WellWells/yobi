/**
 * Keyboard navigation from a search box inside a Mantine menu dropdown, the way `Menu.Search`
 * does it: arrows move a `data-menu-active` highlight over the dropdown's own items while focus
 * (and the typed query) stays in the box, and Enter picks the highlighted item.
 *
 * `Menu.Search` itself is not used because a menu holds one search: it registers with the whole
 * menu and overwrites the menu's clear-on-close callback, so one inside a submenu of a menu that
 * has its own search (the header's ⋮) would leave that search's text behind after closing.
 */

const ITEM_SELECTOR = '[data-menu-item]:not([data-disabled])';
const ACTIVE_ATTR = 'data-menu-active';

export type MenuNavKey = 'ArrowDown' | 'ArrowUp';

export function isMenuNavKey(key: string): key is MenuNavKey {
  return key === 'ArrowDown' || key === 'ArrowUp';
}

/**
 * The index highlighted after an arrow key, wrapping at both ends; from no highlight (-1), down
 * starts at the first item and up at the last. -1 when there is nothing to highlight.
 */
export function nextMenuIndex(current: number, count: number, key: MenuNavKey): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

export { isComposingKey } from '../../../utils/imeKeys';

/** A key that types a character: it belongs in the search box, wherever focus is in the list. */
export function isTypingKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function menuDropdownOf(node: Element | null): HTMLElement | null {
  return node?.closest<HTMLElement>('[data-menu-dropdown]') ?? null;
}

/**
 * Whether `node` is the row that opens this submenu dropdown. Mantine's Popover labels a dropdown
 * with its target's id (`aria-labelledby`), so another submenu row of the parent menu ("Export ▸",
 * "Font ▸") does not count.
 */
export function isSubmenuTargetOf(dropdown: HTMLElement | null, node: EventTarget | null): boolean {
  const targetId = dropdown?.getAttribute('aria-labelledby');
  return !!targetId && node instanceof Element && node.id === targetId;
}

/**
 * Focus that a keyboard-opened submenu's search box takes over: Mantine moved it to a row of the
 * submenu, or it is still on the row that opened the submenu. Focus anywhere else (the parent
 * menu's own search, another submenu row) means the submenu opened under a passing pointer, and
 * the reader keeps their place.
 */
export function isSubmenuKeyboardFocus(dropdown: HTMLElement | null, active: Element | null): boolean {
  if (!dropdown || !active) return false;
  return dropdown.contains(active) || isSubmenuTargetOf(dropdown, active);
}

/** After Mantine's own submenu focus (16 ms) moves focus to the first item. */
export const SUBMENU_FOCUS_DELAY_MS = 40;

/**
 * Gives a submenu's search box the focus a keyboard open brings in: → or Enter on the submenu's
 * row has Mantine focus the submenu's first row, and the box takes that over as it arrives — not
 * only at mount, because when a passing pointer already opened the submenu, Enter on its row only
 * moves focus in. A timer covers the mount, in case Mantine's first-row focus found no row yet.
 * A hover open moves no focus, so nothing is taken. Returns the cleanup.
 */
export function watchSubmenuKeyboardFocus(input: HTMLElement): () => void {
  const dropdown = menuDropdownOf(input);
  if (!dropdown) return () => undefined;
  const takeOver = (event: FocusEvent): void => {
    if (event.target !== input && isSubmenuTargetOf(dropdown, event.relatedTarget)) input.focus();
  };
  dropdown.addEventListener('focusin', takeOver);
  const timer = window.setTimeout(() => {
    if (isSubmenuKeyboardFocus(dropdown, document.activeElement)) input.focus();
  }, SUBMENU_FOCUS_DELAY_MS);
  return () => {
    dropdown.removeEventListener('focusin', takeOver);
    window.clearTimeout(timer);
  };
}

/** The dropdown's own enabled items, not those of a submenu nested inside it. */
export function menuItemsOf(dropdown: HTMLElement | null): HTMLElement[] {
  if (!dropdown) return [];
  return Array.from(dropdown.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
    .filter((item) => item.closest('[data-menu-dropdown]') === dropdown);
}

export function clearMenuActive(dropdown: HTMLElement | null): void {
  for (const item of menuItemsOf(dropdown)) item.removeAttribute(ACTIVE_ATTR);
}

export function setMenuActive(dropdown: HTMLElement | null, item: HTMLElement | null): void {
  clearMenuActive(dropdown);
  if (!item) return;
  item.setAttribute(ACTIVE_ATTR, 'true');
  item.scrollIntoView({ block: 'nearest' });
}

/** Moves the highlight one item; returns false when the dropdown has no items. */
export function moveMenuActive(dropdown: HTMLElement | null, key: MenuNavKey): boolean {
  const items = menuItemsOf(dropdown);
  if (items.length === 0) return false;
  const current = items.findIndex((item) => item.hasAttribute(ACTIVE_ATTR));
  setMenuActive(dropdown, items[nextMenuIndex(current, items.length, key)] ?? null);
  return true;
}

/**
 * Picks the highlighted item: a plain item is clicked; a submenu row opens its submenu, as
 * `Menu.Search` does. Returns false when nothing is highlighted.
 */
export function pickMenuActive(dropdown: HTMLElement | null): boolean {
  const target = menuItemsOf(dropdown).find((item) => item.hasAttribute(ACTIVE_ATTR));
  if (!target) return false;
  if (target.hasAttribute('data-sub-menu-item')) {
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  } else {
    target.click();
  }
  return true;
}
