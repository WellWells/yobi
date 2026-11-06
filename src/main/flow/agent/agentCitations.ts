import { citationHost, formatSourcesSection, mdLinkDestination } from '../../../shared/citations';
import type { CitationSource } from '../../../shared/citations';

/*
 * One run's sources under one numbering. Every research call numbers its own sources from [1], so
 * two calls would both say [1] about different pages; the run renumbers them as they arrive, the
 * model cites the run's numbers, and the answer it hands back is turned into links plus one list.
 */

/** A research answer's citation as `linkifyCitations` writes it: `[\[3\]](<url>)`. */
const LINKED_MARKER = /\[\\\[(\d{1,3})\\\]\]\(<([^>]*)>\)/g;
/** The run's own markers in a written answer: linked (copied from an observation) or plain. */
const ANSWER_MARKER = /\[\\\[(\d{1,3})\\\]\]\(<[^>]*>\)|\[(\d{1,3})\](?!\()/g;
/** Code is left alone: `[0]` there is an index, not a citation. */
const CODE_SPAN = /(```[\s\S]*?```|`[^`\n]*`)/g;
/**
 * A `sourcesLine` the model copied into its answer, with the blank lines before it. It is written for
 * the model; the user gets the list.
 */
const COPIED_SOURCES_LINE = /\n*^[ \t]*SOURCES:[ \t]*\[\d{1,3}\][^\n]*$/gm;

export interface ResearchSource {
  title: string;
  link: string;
}

export interface AbsorbedResearch {
  /** The answer with plain `[n]` markers in the run's numbering. */
  text: string;
  /** The sources the answer cites, in the run's numbering, in order of first citation. */
  cited: CitationSource[];
}

export interface CitationPool {
  absorb(answer: string, sources: readonly ResearchSource[]): AbsorbedResearch;
  get(id: number): CitationSource | undefined;
  readonly size: number;
}

function decodeDestination(url: string): string {
  return url.replace(/%3C/g, '<').replace(/%3E/g, '>');
}

export function createCitationPool(): CitationPool {
  const byUrl = new Map<string, CitationSource>();
  const byId = new Map<number, CitationSource>();
  return {
    absorb(answer, sources) {
      const titles = new Map(sources.map((source) => [source.link, source.title]));
      const cited: CitationSource[] = [];
      const text = answer.replace(LINKED_MARKER, (_match, _local: string, destination: string) => {
        const url = decodeDestination(destination);
        let source = byUrl.get(url);
        if (!source) {
          source = { id: byId.size + 1, title: titles.get(url)?.trim() || citationHost(url), url };
          byUrl.set(url, source);
          byId.set(source.id, source);
        }
        if (!cited.includes(source)) cited.push(source);
        return `[${source.id}]`;
      });
      return { text, cited };
    },
    get: (id) => byId.get(id),
    get size() {
      return byId.size;
    },
  };
}

export interface RelinkedAnswer {
  text: string;
  /** What the answer cites, numbered as it now shows them; empty when it cites nothing. */
  sources: CitationSource[];
}

/**
 * Every run-numbered marker becomes a link, numbered 1, 2, 3 in the order the answer first cites
 * them. A marker the run never handed out is left as written, and a copied SOURCES line is dropped.
 * The source list is NOT appended here: the reply still ends with its recap and memory lines, which
 * are read off its tail, so the list goes on once they are out (`withSourcesSection`).
 */
export function relinkCitations(answer: string, pool: CitationPool): RelinkedAnswer {
  if (pool.size === 0) return { text: answer, sources: [] };
  const shown = new Map<number, CitationSource>();
  const relink = (prose: string): string => prose.replace(ANSWER_MARKER, (match, linked: string | undefined, plain: string | undefined) => {
    const source = pool.get(Number(linked ?? plain));
    if (!source) return match;
    let entry = shown.get(source.id);
    if (!entry) {
      entry = { ...source, id: shown.size + 1 };
      shown.set(source.id, entry);
    }
    return `[\\[${entry.id}\\]](${mdLinkDestination(entry.url)})`;
  });
  const text = answer
    .split(CODE_SPAN)
    .map((part, index) => (index % 2 === 0 ? relink(part.replace(COPIED_SOURCES_LINE, '')) : part))
    .join('');
  return { text, sources: [...shown.values()] };
}

/** The answer with its source list after it — once nothing else has to be read off its tail. */
export function withSourcesSection(answer: string, sources: readonly CitationSource[] | undefined, heading: string): string {
  return !sources?.length ? answer : `${answer.trimEnd()}\n\n${formatSourcesSection(sources, heading)}`;
}

/** The SOURCES line the model reads under a research answer: the run's numbers and page titles. */
export function sourcesLine(cited: readonly CitationSource[]): string {
  if (cited.length === 0) return '';
  const titled = cited.map((source) => {
    const title = source.title.length > 80 ? `${source.title.slice(0, 80)}…` : source.title;
    return `[${source.id}] ${title}`;
  });
  return `SOURCES: ${titled.join(' · ')}`;
}
