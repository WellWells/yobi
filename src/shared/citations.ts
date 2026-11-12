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

/** A citation's link words: only a number, `[1]` (often written `[\[1\]]`) or `1`. */
export function isCitationLabel(linkText: string): boolean {
  return /^\[?\d{1,3}\]?$/.test(linkText.replace(/\\(.)/g, '$1').trim());
}

/** A URL as a Markdown link destination: angle-bracketed, so spaces and parentheses survive. */
export function mdLinkDestination(url: string): string {
  return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

/** A page title as link text: brackets would end the label early. */
export function mdLinkLabel(title: string): string {
  return title.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The source list an answer ends with — one `n. [title](<url>)` line per source, the shape
 * `parseCitationSources` reads back — under a rule and a bold heading.
 */
export function formatSourcesSection(sources: readonly CitationSource[], heading: string): string {
  const list = sources.map((source) => `${source.id}. [${mdLinkLabel(source.title) || source.url}](${mdLinkDestination(source.url)})`);
  return `---\n\n**${heading}**\n\n${list.join('\n')}`;
}

export function citationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The label before a country code that makes a two-level public suffix: `co.uk`, `com.tw`, `go.jp`. */
const SECOND_LEVEL_SUFFIX = /^(?:com|co|org|net|gov|edu|ac|ne|or|go|gr|ed|lg|mil|idv|game|ebiz|club)$/;

/**
 * The site's own name, the way a citation chip shows it: the registrable domain's label, without
 * subdomains or the public suffix (`redlib.ssps.io` → `ssps`, `app.cohorted.co.uk` → `cohorted`).
 */
export function citationSite(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return host;
  const labels = host.replace(/^(?:www|m)\./, '').split('.').filter(Boolean);
  if (labels.length < 2) return labels[0] ?? host;
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const suffixLabels = last.length === 2 && SECOND_LEVEL_SUFFIX.test(second) ? 2 : 1;
  return labels[Math.max(0, labels.length - suffixLabels - 1)];
}
