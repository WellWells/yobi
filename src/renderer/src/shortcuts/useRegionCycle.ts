import { useShortcutAction } from './useShortcutAction';

/**
 * F6 / Shift+F6 move focus between the window's regions, as in Windows' own apps (Explorer,
 * Outlook, Edge): the sidebar, the main content, the composer, a side panel (WCAG 2.4.1 bypass
 * blocks). A region is any element marked `data-region` that is drawn (hidden
 * views stay in the DOM); the order is the document's. Regions may nest (the composer inside the
 * main landmark): the one focus is in is the innermost that holds it.
 */
export const REGION_ATTR = 'data-region';

/**
 * Inside a region, what F6 lands on first: the region's own pick — a selector in its
 * `data-region-focus` (the list's current row, the composer's text box) — else its first stop.
 * Selectors joined by `||` are tried in order (a comma list would pick whichever comes first in the
 * document): the knowledge base's current file row, else its "Add" button when the table is empty.
 */
export const REGION_FOCUS_OR = '||';
const TABBABLE = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex="0"]', '[contenteditable="true"]',
].join(', ');

function drawn(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** The drawn regions in document order. */
export function regionsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${REGION_ATTR}]`)).filter(drawn);
}

/** Which region index F6 (`step` 1) or Shift+F6 (-1) goes to from the region holding focus (-1 = none). */
export function nextRegionIndex(count: number, current: number, step: 1 | -1): number | null {
  if (count === 0) return null;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** The innermost region that holds `active`, as an index into `regions`; -1 when none does. */
export function regionHolding(regions: readonly HTMLElement[], active: Element | null): number {
  let found = -1;
  regions.forEach((region, index) => {
    if (active && region.contains(active)) found = index;
  });
  return found;
}

/** Puts focus in a region: its preferred element, else its first stop, else the region itself. */
export function focusRegion(region: HTMLElement): void {
  const regions = regionsIn(region);
  // A stop inside a nested region belongs to that region, not this one.
  const own = (el: Element): boolean => drawn(el) && !regions.some((inner) => inner !== region && inner.contains(el));
  const preferred = (region.dataset.regionFocus ?? '').split(REGION_FOCUS_OR).map((s) => s.trim()).filter(Boolean);
  const target = [...preferred, TABBABLE].reduce<HTMLElement | undefined>(
    (found, selector) => found ?? Array.from(region.querySelectorAll<HTMLElement>(selector)).find(own),
    undefined,
  );
  if (target) {
    target.focus();
    return;
  }
  if (!region.hasAttribute('tabindex')) region.setAttribute('tabindex', '-1');
  region.focus();
}

/** Moves focus to the next (1) or previous (-1) region of the document. */
export function cycleRegion(step: 1 | -1, root: Document = document): void {
  const regions = regionsIn(root);
  const index = nextRegionIndex(regions.length, regionHolding(regions, root.activeElement), step);
  const region = index === null ? undefined : regions[index];
  if (region) focusRegion(region);
}

/** Registers F6 / Shift+F6 (registry `nav.nextRegion` / `nav.previousRegion`). Mount once, in App. */
export function useRegionCycle(): void {
  useShortcutAction('nav.nextRegion', () => cycleRegion(1));
  useShortcutAction('nav.previousRegion', () => cycleRegion(-1));
}
