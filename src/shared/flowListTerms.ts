/**
 * How a step's free-text list fields are cut into items. One copy for the executor and the step
 * editor, so the editor's count ("2 × 3 = 6 searches", "several symbols, no sub-variables") is the
 * one the run will see.
 */

/** Mail filters: comma-separated words (`,` `，` `、`), trimmed, blanks dropped. */
export function splitTerms(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,，、]/).map((term) => term.trim()).filter(Boolean);
}

/**
 * Stock symbols: one per line or comma-separated. The Chinese placeholder lists them with 、, so
 * the full-width comma and 、 separate too.
 */
export function splitSymbols(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\n,，、]+/).map((symbol) => symbol.trim()).filter(Boolean);
}

/** Senders × keywords: every pair is one mail search, and a step makes at most this many. */
export const MAIL_FETCH_MAX_SEARCHES = 12;

/** The searches a mail step's filters make (a blank field counts as one "any"). */
export function mailFetchSearchCount(config: Record<string, string>): number {
  return Math.max(1, splitTerms(config.from).length) * Math.max(1, splitTerms(config.keywords).length);
}
