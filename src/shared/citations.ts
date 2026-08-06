/**
 * Reading back the citations a `/search` answer carries.
 *
 * `search/synthesize.ts` makes the model put `[n]` on every sourced sentence and
 * `linkifyCitations` turns each one into `[\[n\]](<url>)`, which renders as the literal
 * text `[n]`. `chat/searchCommand.ts` then appends the numbered source list. Both halves
 * live in the saved markdown, so a selection made in the rendered answer can be traced
 * back to the pages it came from without asking the model anything.
 *
 * The list heading is localized, so nothing here may key off it — matching the numbered
 * link shape is what keeps this working in every language.
 */

export interface CitationSource {
  id: number;
  title: string;
  url: string;
}

/** `1. [title](<url>)` — the angle-bracket form is what `mdLinkDestination` emits. */
const SOURCE_LINE = /^[ \t]*(\d{1,3})\.[ \t]+\[([^\]]*)\]\((?:<([^>]*)>|([^)\s]+))\)[ \t]*$/gm;

/** The rendered form of an inline citation is the bare text `[n]`. */
const CITATION_MARKER = /\[(\d{1,3})\]/g;

export function parseCitationSources(markdown: string): CitationSource[] {
  const sources: CitationSource[] = [];
  const seen = new Set<number>();
  SOURCE_LINE.lastIndex = 0;
  let match = SOURCE_LINE.exec(markdown);
  while (match) {
    const id = Number.parseInt(match[1], 10);
    const url = (match[3] ?? match[4] ?? '').trim();
    if (url && !seen.has(id)) {
      seen.add(id);
      sources.push({ id, title: match[2].trim() || url, url });
    }
    match = SOURCE_LINE.exec(markdown);
  }
  return sources.sort((a, b) => a.id - b.id);
}

export function citationNumbersIn(text: string): number[] {
  const numbers: number[] = [];
  const seen = new Set<number>();
  CITATION_MARKER.lastIndex = 0;
  let match = CITATION_MARKER.exec(text);
  while (match) {
    const id = Number.parseInt(match[1], 10);
    if (!seen.has(id)) {
      seen.add(id);
      numbers.push(id);
    }
    match = CITATION_MARKER.exec(text);
  }
  return numbers;
}

/**
 * Sources backing a selection. `selected` wins when it carries markers of its own;
 * `block` is the fallback for a phrase picked out of the middle of a cited sentence,
 * where the marker sits at the sentence end and falls outside the selection.
 *
 * A number with no matching entry in the source list is dropped rather than shown as an
 * unresolved citation — the same stance the synthesis prompt takes when it tells the model
 * to use only numbers that exist.
 */
export function resolveSelectionCitations(
  selected: string,
  block: string,
  sources: readonly CitationSource[],
): CitationSource[] {
  if (sources.length === 0) return [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const direct = citationNumbersIn(selected);
  const numbers = direct.length > 0 ? direct : citationNumbersIn(block);
  const resolved: CitationSource[] = [];
  for (const id of numbers) {
    const source = byId.get(id);
    if (source) resolved.push(source);
  }
  return resolved;
}

/** Host shown next to a source title. Falls back to the raw url when it will not parse. */
export function citationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
