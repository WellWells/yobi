export interface CitationSource {
  id: number;
  title: string;
  url: string;
}

const SOURCE_LINE = /^[ \t]*(\d{1,3})\.[ \t]+\[([^\]]*)\]\((?:<([^>]*)>|([^)\s]+))\)[ \t]*$/gm;

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

export function citationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
