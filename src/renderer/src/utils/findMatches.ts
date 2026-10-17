export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

/**
 * Lower-cases one UTF-16 unit at a time and keeps the unit when its lower case is longer
 * ('İ' → 'i̇'), so an offset in the folded text is the same offset in the original.
 */
export function foldCase(text: string): string {
  let out = '';
  for (const unit of text.split('')) {
    const lower = unit.toLowerCase();
    out += lower.length === 1 ? lower : unit;
  }
  return out;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const SPACELESS_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/**
 * A letter that words are made of AND separated around. Chinese and Japanese write words without
 * spaces, so "whole word" has nothing to hold on to there: a query edge in those scripts always counts
 * as a boundary, and only Latin-style edges are checked.
 */
function joinsWords(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char) && !SPACELESS_SCRIPT.test(char);
}

function isWholeWord(text: string, start: number, end: number): boolean {
  const first = text[start];
  const last = text[end - 1];
  if (joinsWords(first) && joinsWords(text[start - 1])) return false;
  if (joinsWords(last) && joinsWords(text[end])) return false;
  return true;
}

/** Non-overlapping `[start, end)` ranges of `query` in `text`, in order. */
export function findMatches(text: string, query: string, options: FindOptions): Array<[number, number]> {
  if (!query) return [];
  const haystack = options.caseSensitive ? text : foldCase(text);
  const needle = options.caseSensitive ? query : foldCase(query);
  const matches: Array<[number, number]> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const end = at + needle.length;
    if (!options.wholeWord || isWholeWord(text, at, end)) {
      matches.push([at, end]);
      from = end;
    } else {
      from = at + 1;
    }
  }
  return matches;
}

/** The match to land on: the first one at or below the top of the view, else the last one above it. */
export function firstMatchFrom(tops: readonly number[], viewTop: number): number {
  if (tops.length === 0) return -1;
  const below = tops.findIndex((top) => top >= viewTop);
  return below >= 0 ? below : tops.length - 1;
}
