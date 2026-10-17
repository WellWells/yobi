/**
 * The ⋮ menu's search box. Pure: the menu describes each searchable row as data, and this decides
 * which rows are drawn, whether each side of the divider has anything left, and whether to say
 * that nothing matched.
 */

/** How a flattened submenu row names its parent: "Export › PDF or image…". */
export const SEARCH_PATH_SEPARATOR = ' › ';

export type HeaderMenuSide = 'actions' | 'display';

export interface HeaderMenuSearchRow {
  id: string;
  side: HeaderMenuSide;
  /** The row's own label; a control with several words on it (the layout switch) gives them all. */
  labels: string | readonly string[];
  /** The submenu a flattened row lives in when nothing is typed ("Export", "Font"). */
  parents?: readonly string[];
}

export interface HeaderMenuSearchPlan {
  /** Something was typed: submenus are flattened and only matching rows are drawn. */
  searching: boolean;
  /** Ids of the rows to draw; every row when nothing is typed. */
  visible: ReadonlySet<string>;
  /** Whether anything is left above the divider (actions) and below it (display settings). */
  actions: boolean;
  display: boolean;
  /** Searching and nothing matched: the menu says so instead of drawing two empty sides. */
  empty: boolean;
}

function fold(text: string): string {
  // NFKC: full-width letters typed through an IME match the half-width label ("PDF" typed full-width finds "PDF").
  return text.normalize('NFKC').toLowerCase();
}

/** What the user typed, as words; every word has to be found somewhere in the row's path. */
export function searchTerms(query: string): string[] {
  return fold(query).split(/\s+/u).filter(Boolean);
}

export function isMenuSearching(query: string): boolean {
  return searchTerms(query).length > 0;
}

/** Case-insensitive: each typed word appears in the row's label or in one of its parents' labels. */
export function matchesMenuSearch(
  query: string,
  labels: string | readonly string[],
  parents: readonly string[] = [],
): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const haystack = fold([...parents, ...(typeof labels === 'string' ? [labels] : labels)].join(' '));
  return terms.every((term) => haystack.includes(term));
}

/** The label a flattened submenu row shows while searching. */
export function searchRowLabel(parents: readonly string[], label: string): string {
  return [...parents, label].join(SEARCH_PATH_SEPARATOR);
}

/** Marks the info area's row: it is the conversation, never a search result to highlight. */
export const INFO_ROW_ATTR = 'data-header-info';

/**
 * The row a search highlights so Enter acts on it: the first enabled match (the caller passes the
 * dropdown's enabled items in order), never the info row. Null when there is none.
 */
export function firstSearchMatch<T extends { hasAttribute: (name: string) => boolean }>(items: readonly T[]): T | null {
  return items.find((item) => !item.hasAttribute(INFO_ROW_ATTR)) ?? null;
}

export function planMenuSearch(query: string, rows: readonly HeaderMenuSearchRow[]): HeaderMenuSearchPlan {
  const searching = isMenuSearching(query);
  const matched = searching
    ? rows.filter((row) => matchesMenuSearch(query, row.labels, row.parents))
    : rows;
  const visible = new Set(matched.map((row) => row.id));
  const actions = matched.some((row) => row.side === 'actions');
  const display = matched.some((row) => row.side === 'display');
  return { searching, visible, actions, display, empty: searching && matched.length === 0 };
}
