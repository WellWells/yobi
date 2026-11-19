import { config } from '../../config';
import { sendLog } from '../../helpers';
import { isByokTargetUrl } from '../../../shared/types';
import type { AgentStageLabel } from '../../../shared/types';
import { knowledgeBasesNamedIn, parseKbCitationUrl } from '../../../shared/knowledgeBase';
import type { KnowledgeBase, KnowledgeFileScope } from '../../../shared/knowledgeBase';
import { maskSecrets } from '../../../shared/secretMask';
import { fenceUntrusted } from '../../../shared/promptFencing';
import { isLeanPromptProvider, standardWebBudget, synthesisBudget } from '../../search/budgets';
import type { SynthesisBudget } from '../../search/budgets';
import { buildCitedPrompt, linkifyCitations, synthesize } from '../../search/synthesize';
import type { SearchAsker, SourceDoc } from '../../search/types';
import { knowledgeCutLabel } from '../../../shared/knowledgeStatus';
import type { KnowledgeCut } from '../../../shared/knowledgeStatus';
import { getLangCache, t } from '../../i18n';
import { ensureKnowledgeBaseFresh, knowledgeBaseIndex, onKbStatus } from '../../knowledge/kbStore';
import { retrieveKbDocs } from '../../knowledge/kbRetrieve';
import { FlowAbortError } from '../runtime';
import type { ResearchSource } from './agentCitations';

/*
 * `kb_search`: answers from the user's own document folders, with citations, the way `research`
 * answers from the web — the passages that match are packed into one cited prompt for the run's
 * model, and the cited answer comes back with its files as the run's sources. A base small enough
 * to fit is read whole. The model's `query` and the user's own words are both searched, which is
 * query rewriting at no extra model call: the agent has
 * already read the goal and written keywords for it.
 *
 * A built-in tool and not a connector: a connector's catalog is the first thing a tight provider
 * drops, and a connector's results never join the citation pool.
 */

/** A base this run may search, as the catalog names it. */
export interface KnowledgeScopeEntry {
  id: string;
  name: string;
  /** The user attached it to this conversation or named it in the message: searched first. */
  picked?: boolean;
  /**
   * The user limited the question to these documents of the base (relative paths, the index's
   * own): searched, listed and read whole only among them. Absent = the whole base.
   */
  files?: readonly string[];
}

/** A lister that sees only the documents `files` leaves in each base (all of a base it does not name). */
function scopedLister(list: KbDocumentLister, files: KnowledgeFileScope | undefined): KbDocumentLister {
  if (!files) return list;
  return (kb) => {
    const only = files[kb.id];
    return only ? list(kb).filter((file) => only.includes(file.path)) : list(kb);
  };
}

function scopeOf(entries: readonly KnowledgeScopeEntry[]): KnowledgeFileScope | undefined {
  const limited = entries.filter((entry) => entry.files);
  return limited.length > 0 ? Object.fromEntries(limited.map((entry) => [entry.id, entry.files ?? []])) : undefined;
}

/**
 * The bases a run may search: every one on the desktop (`'all'`), a bot account's granted ones
 * otherwise. Picked = attached to the conversation or named in the user's words; a hint, never a
 * limit — the model may still search another base in scope.
 */
export function knowledgeEntriesFor(allowed: readonly string[] | 'all', picked: readonly string[], words: string): KnowledgeScopeEntry[] {
  if (allowed !== 'all' && allowed.length === 0) return [];
  const bases = (config.knowledgeBases ?? []).filter((kb) => allowed === 'all' || allowed.includes(kb.id));
  const named = new Set([...picked, ...knowledgeBasesNamedIn(words, bases)]);
  return bases.map((kb) => ({ id: kb.id, name: kb.name, ...(named.has(kb.id) ? { picked: true } : {}) }));
}

function names(entries: readonly KnowledgeScopeEntry[]): string {
  return entries.map((entry) => `"${entry.name}"`).join(', ');
}

/** The base names one catalog line carries; past it the rest are counted, and an omitted "base" still searches them. */
export const KB_BRIEF_NAMES_MAX = 120;

function listedNames(entries: readonly KnowledgeScopeEntry[]): string {
  const ordered = [...entries.filter((entry) => entry.picked), ...entries.filter((entry) => !entry.picked)];
  const shown: string[] = [];
  let used = 0;
  for (const entry of ordered) {
    const name = `"${entry.name}"${entry.picked ? ' (picked)' : ''}`;
    if (shown.length > 0 && used + name.length > KB_BRIEF_NAMES_MAX) break;
    shown.push(name);
    used += name.length + 2;
  }
  const rest = ordered.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ');
}

/**
 * Tier 1, built per run. The names are the user's content, like a connector entry, so the line is
 * bounded (`KB_BRIEF_NAMES_MAX`) and charged against the connectors' room, not the built-ins'.
 */
export function knowledgeBrief(entries: readonly KnowledgeScopeEntry[]): string {
  const picked = entries.some((entry) => entry.picked);
  return `- "kb_search": Cited answers from the user's own files: ${listedNames(entries)}. For their work or files, first: before connectors or research. config: "query" (REQUIRED), "base" (name; omit = ${picked ? 'picked' : 'all'}), "files" ("true" lists them).`;
}

export const KB_SEARCH_LINE = '- "kb_search": Search the user\'s own document folders (knowledge bases) and answer from them with citations [n] to the files. For anything about their work, projects, policies or documents use it first, before connectors or research; if it finds nothing, say so rather than answering from memory. config keys: "query" (keywords in the documents\' language — names, terms, numbers; REQUIRED), "base" (a knowledge base\'s name; omit = the one the user picked, else all), "files" ("true" = list the documents instead) → returns: a cited answer, or the file list.';

export interface KnowledgeToolContext {
  entries: readonly KnowledgeScopeEntry[];
  providerUrl: string;
  asker?: SearchAsker;
  signal?: AbortSignal;
  onStage?: (label: AgentStageLabel, detail?: string) => void;
}

export interface KnowledgeToolOutcome {
  observation: string;
  status: 'ok' | 'error';
  sources?: ResearchSource[];
}

const FILE_LIST_MAX = 200;
/** BYOK has no page window, but a cited answer need not read a whole library either. */
const BYOK_KB_BUDGET: SynthesisBudget = { bytes: 240_000, charsPlusBreaks: 80_000 };

function fold(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase();
}

function budgetFor(providerUrl: string): SynthesisBudget {
  if (!isByokTargetUrl(providerUrl)) return standardWebBudget(providerUrl);
  const window = synthesisBudget(providerUrl);
  return { bytes: Math.min(window.bytes, BYOK_KB_BUDGET.bytes), charsPlusBreaks: Math.min(window.charsPlusBreaks, BYOK_KB_BUDGET.charsPlusBreaks) };
}

/** The bases a call means: the one it names, else the picked ones, else every one in scope. */
function chosenBases(raw: string, entries: readonly KnowledgeScopeEntry[], all: readonly KnowledgeBase[]): KnowledgeBase[] | string {
  const allowed = all.filter((kb) => entries.some((entry) => entry.id === kb.id));
  const wanted = fold(raw);
  if (wanted) {
    const named = allowed.filter((kb) => [kb.name, kb.id, ...kb.aliases].some((name) => fold(name) === wanted));
    const loose = named.length > 0 ? named : allowed.filter((kb) => [kb.name, ...kb.aliases].some((name) => fold(name).includes(wanted) || wanted.includes(fold(name))));
    return loose.length > 0 ? loose : `ERROR: no knowledge base is called "${raw}". The ones you can search: ${names(entries)}.`;
  }
  const picked = allowed.filter((kb) => entries.some((entry) => entry.id === kb.id && entry.picked));
  return picked.length > 0 ? picked : allowed;
}

/**
 * The documents, `FILE_LIST_MAX` at a time from #`from` (1-based, across the bases in order): a base
 * of 643 files can be walked page by page, each file once. Headers are not counted, so the
 * remainder is a count of files.
 */
export function fileList(bases: readonly KnowledgeBase[], from = 1, list: KbDocumentLister = (kb) => knowledgeBaseIndex(kb).files()): string {
  const start = Math.max(1, Math.floor(from));
  const end = start + FILE_LIST_MAX - 1;
  const lines: string[] = [];
  let seen = 0;
  for (const kb of bases) {
    const files = list(kb);
    const first = seen + 1;
    seen += files.length;
    const shown = files.slice(Math.max(0, start - first), Math.max(0, end - first + 1));
    if (shown.length === 0) continue;
    lines.push(`${kb.name} (${files.length} documents):`);
    for (const file of shown) lines.push(`- ${file.path}${file.error ? ' (no readable text)' : ''}`);
  }
  if (seen === 0) return 'No documents yet.';
  if (start > seen) return `Only ${seen} documents: "files": "true" lists from the first.`;
  const last = Math.min(end, seen);
  lines.unshift(`Documents ${start}–${last} of ${seen}:`);
  if (seen > last) lines.push(`… ${seen - last} more: "files": "${last + 1}" lists the next ones.`);
  return lines.join('\n');
}

/**
 * The bases a "knowledge base only" run is limited to — the ones attached to it, as picked entries —
 * or null for a run without the limit. Bases removed since leave an empty limit, never a lifted one:
 * a run the user narrowed must not come back with the full kit.
 */
export function knowledgeOnlyBases(
  state: { knowledgeOnly?: true; knowledgeIds?: readonly string[]; knowledgeFiles?: KnowledgeFileScope },
  entries: readonly KnowledgeScopeEntry[],
  all: readonly KnowledgeBase[] = config.knowledgeBases ?? [],
): { entries: KnowledgeScopeEntry[]; bases: KnowledgeBase[] } | null {
  if (!state.knowledgeOnly) return null;
  const attached = new Set(state.knowledgeIds ?? []);
  // The documents the user picked ride on their base's entry, so every read of it honours them.
  const kept = entries.filter((entry) => attached.has(entry.id)).map((entry) => {
    const files = state.knowledgeFiles?.[entry.id];
    return { ...entry, picked: true, ...(files ? { files } : {}) };
  });
  return { entries: kept, bases: all.filter((kb) => kept.some((entry) => entry.id === kb.id)) };
}

/**
 * A knowledge-only run names its bases' documents in the prompt, so "what files are there?" is
 * answered on the first turn without a call — at most this many, in at most this many characters;
 * past either, the model lists the rest with `"files": "true"`.
 */
export const KB_ONLY_LIST_MAX = 200;
export const KB_ONLY_LIST_CHARS = 4_000;

/** What a base holds, as the index has it: relative paths, and whether any text was read. */
export type KbDocumentLister = (kb: KnowledgeBase) => ReadonlyArray<{ path: string; error: string }>;

function documentList(bases: readonly KnowledgeBase[], list: KbDocumentLister): string {
  const lines: string[] = [];
  let shown = 0;
  let total = 0;
  let used = 0;
  for (const kb of bases) {
    const files = list(kb);
    total += files.length;
    const head = `${kb.name} (${files.length} documents):`;
    lines.push(head);
    used += head.length + 1;
    for (const file of files) {
      const line = `- ${file.path}${file.error ? ' (no readable text)' : ''}`;
      if (shown >= KB_ONLY_LIST_MAX || used + line.length + 1 > KB_ONLY_LIST_CHARS) break;
      lines.push(line);
      used += line.length + 1;
      shown += 1;
    }
  }
  if (total > shown) lines.push(`… ${total - shown} more not listed: "kb_search" with "files": "true" lists them, ${FILE_LIST_MAX} at a time.`);
  return lines.join('\n');
}

/**
 * The approach of a run the user limited to their knowledge bases (a chat opened from a base's
 * page, or the composer's "knowledge base only"): `kb_search` is its only tool, so the usual rules
 * — use every tool, go online, never answer from memory "because a tool can" — do not apply, and
 * "files" and "documents" have to mean the base's, not the computer's (asked "what files
 * are there?" in such a chat, the full agent lists the user's Documents folder). The document list
 * is the user's own names, fenced like any text the prompt did not write.
 */
export function knowledgeOnlyRules(
  bases: readonly KnowledgeBase[],
  list: KbDocumentLister = (kb) => knowledgeBaseIndex(kb).files(),
  files?: KnowledgeFileScope,
): string[] {
  const where = names(bases.map((kb) => ({ id: kb.id, name: kb.name })));
  return [
    `- The user chose to ask ONLY the knowledge base ${where}: answer only from its documents — never from`,
    '  memory, general knowledge or the web.',
    ...(files
      ? ['- The user picked only the documents listed below: the base\'s other documents are out of reach; never', '  claim to have read them.']
      : []),
    '- "Files", "documents", "here" and "these" mean its documents, listed below. What they say comes from',
    '  "kb_search"; a question about which documents there are is answered from the list on step 1.',
    '- When the documents do not say it, "finish" saying so plainly and what they do cover. Never fill the gap.',
    '- A greeting, a lone word, or asking what you can do: "finish" on step 1, "done": true, no question',
    '  (what you do: search these documents and answer from them, with sources).',
    '',
    'DOCUMENTS IN THE KNOWLEDGE BASE:',
    fenceUntrusted('documents', documentList(bases, scopedLister(list, files))),
  ];
}

async function freshen(bases: readonly KnowledgeBase[], ctx: KnowledgeToolContext): Promise<string[]> {
  const missing: string[] = [];
  for (const kb of bases) {
    if (ctx.signal?.aborted) throw new FlowAbortError();
    const stop = onKbStatus((status) => {
      if (status.id === kb.id && status.state === 'indexing' && status.total > 0) ctx.onStage?.('indexing', `${status.done}/${status.total}`);
    });
    try {
      await ensureKnowledgeBaseFresh(kb, { uiLanguage: config.locale, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    } catch (err) {
      sendLog(`📚 [Agent] kb_search: ${kb.name}: ${err instanceof Error ? err.message : String(err)}`);
      missing.push(kb.name);
    } finally {
      stop();
    }
  }
  if (ctx.signal?.aborted) throw new FlowAbortError();
  return missing;
}

/**
 * A cited file the index read only part of says so: the model is told (so "not in the
 * documents" can be "not in the part that was read"), and the source's title carries it for the
 * user. Files read whole are left as they are.
 */
export function withReadLimits(docs: readonly SourceDoc[], bases: readonly KnowledgeBase[], label: (cut: KnowledgeCut) => string): SourceDoc[] {
  return docs.map((doc) => {
    const at = parseKbCitationUrl(doc.url);
    const kb = at ? bases.find((base) => base.id === at.kbId) : undefined;
    const cut = kb && at ? knowledgeBaseIndex(kb).fileByPath(at.rel)?.cut : undefined;
    if (!cut) return doc;
    const where = 'page' in cut ? `up to page ${cut.page} of ${cut.pages}` : `the first ${cut.chars} of ${cut.total} characters`;
    return { ...doc, title: `${doc.title} (${label(cut)})`, text: `${doc.text}\n\n(Only part of this file is indexed: ${where}.)` };
  });
}

export async function runKnowledgeSearch(cfg: Record<string, string>, ctx: KnowledgeToolContext): Promise<KnowledgeToolOutcome> {
  if (ctx.signal?.aborted) throw new FlowAbortError();
  const chosen = chosenBases(cfg.base ?? '', ctx.entries, config.knowledgeBases);
  if (typeof chosen === 'string') return { observation: chosen, status: 'error' };
  if (chosen.length === 0) return { observation: 'ERROR: no knowledge base is available to this run.', status: 'error' };
  const missing = await freshen(chosen, ctx);
  const usable = chosen.filter((kb) => !missing.includes(kb.name));
  if (usable.length === 0) {
    return { observation: `ERROR: the folder of ${names(chosen.map((kb) => ({ id: kb.id, name: kb.name })))} is not there; tell the user to check it in Settings.`, status: 'error' };
  }
  const missingNote = missing.length > 0 ? `\n(Not searched — folder missing: ${missing.join(', ')}.)` : '';
  const page = cfg.files === 'true' ? 1 : /^\d+$/.test(cfg.files ?? '') ? Number(cfg.files) : 0;
  const scope = scopeOf(ctx.entries);
  if (page > 0) {
    return { observation: maskSecrets(fileList(usable, page, scopedLister((kb) => knowledgeBaseIndex(kb).files(), scope)), false) + missingNote, status: 'ok' };
  }

  const query = (cfg.query ?? '').trim();
  const words = ctx.asker?.words.trim() ?? '';
  if (!query && !words) return { observation: 'ERROR: "query" is required: the keywords to look for.', status: 'error' };
  const read = retrieveKbDocs(
    usable.map((kb) => ({ kb, index: knowledgeBaseIndex(kb), ...(scope?.[kb.id] ? { only: scope[kb.id] } : {}) })),
    [query, words].filter(Boolean),
    budgetFor(ctx.providerUrl),
  );
  const docs = withReadLimits(read, usable, (cut) => {
    const { key, vars } = knowledgeCutLabel(cut);
    return t(getLangCache(), key, vars);
  });
  const where = names(usable.map((kb) => ({ id: kb.id, name: kb.name })));
  sendLog(`📚 [Agent] kb_search "${query}" in ${usable.map((kb) => kb.name).join(', ')} → ${docs.length} file(s)`);
  if (docs.length === 0) {
    return {
      observation: `Nothing in ${where} matches "${query}". Try the documents' own words (synonyms, the formal term, a number or name), or "files": "true" to see what is there; if it is not there, say so.${missingNote}`,
      status: 'ok',
    };
  }
  ctx.onStage?.('analyzing');
  const prompt = buildCitedPrompt({
    query: query || words,
    docs,
    locale: config.locale,
    lean: isLeanPromptProvider(ctx.providerUrl),
    ...(words ? { asker: words } : {}),
    ...(ctx.asker?.uiLanguage ? { uiLanguage: true } : {}),
  });
  const answer = (await synthesize(prompt, ctx.providerUrl)).trim();
  if (ctx.signal?.aborted) throw new FlowAbortError();
  if (!answer) return { observation: 'ERROR: the answer from the knowledge base came back empty.', status: 'error' };
  // Masked before the citations become links: a mask must never cut a link the pool reads.
  return {
    observation: `Answer from the knowledge base ${where} — cite its [n] as given:\n${linkifyCitations(maskSecrets(answer, false), docs)}${missingNote}`,
    status: 'ok',
    sources: docs.map((doc) => ({ title: doc.title, link: doc.url })),
  };
}
