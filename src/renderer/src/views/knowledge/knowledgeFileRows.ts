import { fillTemplate } from '../../../../shared/fillTemplate';
import { parseKbNote } from '../../../../shared/kbNote';
import type { KnowledgeAnalysisEvent, KnowledgeAnalysisState, KnowledgeFile } from '../../../../shared/knowledgeStatus';

/**
 * A row has two statuses, in two columns: how the file's text was extracted (text layer, OCR, none,
 * not yet), and its summary (the content analysis the user asked for). The summary's queue state
 * (running, waiting, failed) beats what is stored; a summary older than the file says so — kept,
 * marked, not dropped.
 */
export type KnowledgeSummaryStatus = 'running' | 'queued' | 'failed' | 'stale' | 'ready' | 'none';

/** Tone of a status: a warning (needs the user), progress, plain, or nothing to show. */
export type KnowledgeRowTone = 'warning' | 'busy' | 'plain' | 'empty';

export interface KnowledgeRowAnalysis {
  state: KnowledgeAnalysisState;
  error?: string;
}

export function knowledgeSummaryStatus(file: KnowledgeFile, analysis: KnowledgeRowAnalysis | undefined): KnowledgeSummaryStatus {
  if (analysis?.state === 'running') return 'running';
  if (analysis?.state === 'queued') return 'queued';
  if (analysis?.state === 'failed') return 'failed';
  if (file.ai) return file.ai.stale ? 'stale' : 'ready';
  return 'none';
}

export function extractTone(read: KnowledgeFile['read']): KnowledgeRowTone {
  if (read === 'none') return 'warning';
  return read === 'pending' ? 'busy' : 'plain';
}

export function summaryTone(status: KnowledgeSummaryStatus): KnowledgeRowTone {
  if (status === 'failed' || status === 'stale') return 'warning';
  if (status === 'running' || status === 'queued') return 'busy';
  return status === 'none' ? 'empty' : 'plain';
}

/**
 * The page's view of the queue: the latest event per file. A finished one (done, cancelled) leaves
 * the map — the file list shows its result; a failure stays until the file is queued again.
 */
export function applyAnalysisEvent(
  current: Readonly<Record<string, KnowledgeRowAnalysis>>,
  event: KnowledgeAnalysisEvent,
): Record<string, KnowledgeRowAnalysis> {
  const next = { ...current };
  if (event.state === 'done' || event.state === 'cancelled') delete next[event.path];
  else next[event.path] = event.error ? { state: event.state, error: event.error } : { state: event.state };
  return next;
}

/** How much of a summary the list's hover shows; the whole note is in the side panel. */
export const SUMMARY_PREVIEW_MAX = 360;

/**
 * The summary a row shows on hover: the note's summary section (a note without sections reads as
 * plain text), on one paragraph, cut within `SUMMARY_PREVIEW_MAX`. '' when the note has no summary.
 */
export function summaryPreview(ai: string): string {
  const note = parseKbNote(ai);
  const text = (note ? note.summary : ai).replace(/\s*\n\s*/g, ' ').trim();
  if (text.length <= SUMMARY_PREVIEW_MAX) return text;
  const cut = text.slice(0, SUMMARY_PREVIEW_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > SUMMARY_PREVIEW_MAX * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Files whose name or folder contains every word of the filter (NFKC, any case). */
export function filterKnowledgeFiles(files: readonly KnowledgeFile[], filter: string): KnowledgeFile[] {
  const words = filter.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...files];
  return files.filter((file) => {
    const name = file.path.normalize('NFKC').toLowerCase();
    return words.every((word) => name.includes(word));
  });
}

/** The selection, minus files no longer listed (deleted, renamed outside Yobi). */
export function pruneSelection(selected: ReadonlySet<string>, files: readonly KnowledgeFile[]): Set<string> {
  const listed = new Set(files.map((file) => file.path));
  return new Set([...selected].filter((rel) => listed.has(rel)));
}

/** Of the selected files, those with something to clear or cancel (the toolbar shows these actions only then). */
export function selectionActions(
  selected: ReadonlySet<string>,
  files: readonly KnowledgeFile[],
  analysis: Readonly<Record<string, KnowledgeRowAnalysis>>,
): { withAi: string[]; inQueue: string[] } {
  const withAi: string[] = [];
  const inQueue: string[] = [];
  for (const file of files) {
    if (!selected.has(file.path)) continue;
    if (file.ai) withAi.push(file.path);
    const state = analysis[file.path]?.state;
    if (state === 'queued' || state === 'running') inQueue.push(file.path);
  }
  return { withAi, inQueue };
}

/**
 * Why a file has no text, for its row's tooltip: past the size a base reads, empty, or unreadable
 * (then content analysis can still read it). Matches the prefixes main writes (`kbSync.ts`).
 */
export function extractNoneHint(error: string): string {
  if (error.startsWith('too large:')) return 'kb.page.extract.tooLargeHint';
  if (error.startsWith('empty:')) return 'kb.page.extract.emptyHint';
  return 'kb.page.extract.noneHint';
}

/** Files a delete confirmation names: the first few by name, then how many more. */
export const DELETE_NAMES_SHOWN = 5;

export function deleteNames(rels: readonly string[], t: (key: string) => string): string {
  const names = rels.slice(0, DELETE_NAMES_SHOWN)
    .map((rel) => fillTemplate(t('kb.page.deleteConfirm.name'), { name: splitKnowledgePath(rel).name }))
    .join(t('kb.page.deleteConfirm.separator'));
  const more = rels.length - DELETE_NAMES_SHOWN;
  const tail = more > 0 ? fillTemplate(t('kb.page.deleteConfirm.more'), { count: String(more) }) : '';
  return `${names}${tail}${t('kb.page.deleteConfirm.listEnd')}`;
}

/** The file's name and the folder it is in (relative), for a row's two lines. */
export function splitKnowledgePath(rel: string): { name: string; folder: string } {
  const cut = rel.lastIndexOf('/');
  return cut < 0 ? { name: rel, folder: '' } : { name: rel.slice(cut + 1), folder: rel.slice(0, cut) };
}
