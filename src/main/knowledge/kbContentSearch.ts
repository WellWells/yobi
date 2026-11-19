import { queryTerms } from '../../shared/kbTokens';
import type { KnowledgeSearchResult } from '../../shared/knowledgeStatus';
import { KB_AI_ORD_BASE } from './kbIndex';
import type { KbIndex } from './kbIndex';

/*
 * The base page's content search: which documents say this, and where — the index's own ranking,
 * no model. The same query `kb_search` runs, so what the page finds is
 * what a question would be handed; a stale summary is not found here either.
 */

/** Passages ranked before grouping by file: enough that a file's best passage is among them. */
export const KB_CONTENT_SEARCH_HITS = 60;
/** Files the page lists. */
export const KB_CONTENT_SEARCH_FILES = 30;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 120;

/** Where in the file a passage sits, as its header names it, without the file's own name. */
export function passageLocation(head: string, path: string): string {
  const name = path.split('/').pop() ?? path;
  const rest = head.startsWith(name) ? head.slice(name.length) : head;
  return rest.replace(/^\s*›\s*/, '').replace(/^\s*·\s*/, '').trim();
}

/** The part of a passage around its first match, on one line. */
export function passageSnippet(body: string, terms: readonly string[]): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const found = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
  const at = found.length > 0 ? Math.min(...found) : 0;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(flat.length, at + SNIPPET_AFTER);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Documents whose text (or live summary) matches `query`, best first, one row per file. */
export function searchKbContent(index: KbIndex, query: string): KnowledgeSearchResult {
  const terms = queryTerms(query);
  if (terms.length === 0) return { terms: [], hits: [] };
  const byFile = new Map<string, KnowledgeSearchResult['hits'][number]>();
  for (const hit of index.search([query], KB_CONTENT_SEARCH_HITS)) {
    const seen = byFile.get(hit.path);
    if (seen) {
      seen.matches += 1;
      continue;
    }
    if (byFile.size >= KB_CONTENT_SEARCH_FILES) continue;
    byFile.set(hit.path, {
      path: hit.path,
      location: passageLocation(hit.head, hit.path),
      snippet: passageSnippet(hit.body, terms),
      summary: hit.ord >= KB_AI_ORD_BASE,
      matches: 1,
    });
  }
  return { terms, hits: [...byFile.values()] };
}
