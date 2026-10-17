import {
  applyEdits, parseAssistantReply, placeEdits, revertEdits,
  type AppliedSpot, type DocAssistantResult, type DocAssistantRetry, type DocAssistantTurn, type ParsedAssistantReply, type PlacedEdit,
  type UnplacedEdit,
} from '../../../../shared/docAssistant';
import { plainNotionTitle } from '../../../../shared/notion/notionDisplay';
import { docAssistantApi } from '../../api/electronApi';
import { writeAnswer } from '../../components/chat/answerEditActions';
import { ensureWritingModel } from '../../components/chat/writingToolsActions';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { reloadOpenConversation } from '../../hooks/useReloadOpenConversation';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { useAppStore } from '../../store/appStore';
import { threadOf, useDocAssistantStore, type AssistantEditCard, type AssistantMessage } from '../../store/docAssistantStore';
import { useI18nStore } from '../../store/i18nStore';
import { locateNotionSelection } from '../../utils/notionEditorBlocks';
import { displayLabels, findPassage, setHighlight, shownChars } from './documentMarks';

/** The first reply and two more when it breaks the format or names places that are not in the document. */
export const ASSISTANT_MAX_ATTEMPTS = 3;

let sequence = 0;

function nextId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;
}

/** The document open now, when it is `path`: its text and what the editor needs to save over it. */
function openDocument(path: string): { body: string; title: string; editedAt: string | null; turnCount: number } | null {
  const app = useAppStore.getState();
  if (app.selectedFile?.path !== path || !app.conversation) return null;
  const turn = app.conversation.turns[0];
  if (!turn) return null;
  return {
    body: turn.response,
    title: plainNotionTitle(app.conversation.title ?? ''),
    editedAt: typeof turn.meta.ed === 'string' ? turn.meta.ed : null,
    turnCount: app.conversation.turns.length,
  };
}

/** The panel's conversation as the model reads it: what was said, and what came of each proposal. */
function historyOf(messages: readonly AssistantMessage[]): DocAssistantTurn[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', text: message.quote ? `${message.text}\n(About the selected part: "${message.quote.slice(0, 300)}")` : message.text };
    }
    const notes: string[] = [];
    if (message.ask) notes.push(`(Asked: ${message.ask.question})`);
    if (message.edits?.length) {
      const count = (state: string): number => message.edits!.filter((edit) => edit.state === state).length;
      const parts = [`${count('applied')} in the document`];
      if (count('reverted')) parts.push(`${count('reverted')} undone by the user`);
      if (count('skipped')) parts.push(`${count('skipped')} skipped by the user`);
      if (count('pending')) parts.push(`${count('pending')} not applied yet`);
      notes.push(`(Made ${message.edits.length} edits: ${parts.join(', ')}.)`);
    }
    return { role: 'assistant', text: [message.text, ...notes].join('\n') };
  });
}

/** Where a FIND sits by the words the page shows, for one whose Markdown differs from the document's. */
function visibleLocator(document: string): (find: string) => { start: number; end: number } | null {
  const display = displayLabels();
  return (find) => {
    const chars = shownChars(find, display);
    return chars.length >= 4 ? locateNotionSelection(document, chars, {}, display) : null;
  };
}

const HEADING_LINE = /^#{1,6}[ \t]+(.+?)[ \t#]*$/gm;

/** The last heading before `at`, as plain words: where a change is, said the way the page reads. */
export function headingAbove(document: string, at: number): string {
  const heading = [...document.slice(0, at).matchAll(HEADING_LINE)].at(-1)?.[1] ?? '';
  return plainNotionTitle(heading);
}

interface Attempt {
  parsed: ParsedAssistantReply;
  placed: PlacedEdit[];
  unplaced: UnplacedEdit[];
  problems: string[];
}

function judge(document: string, reply: string): Attempt {
  const parsed = parseAssistantReply(reply);
  const placement = placeEdits(document, parsed.edits, visibleLocator(document));
  return { parsed, placed: placement.placed, unplaced: placement.unplaced, problems: [...parsed.problems, ...placement.problems] };
}

/**
 * Whether `next` is a better reply to keep than `kept`: one that keeps the format beats one that
 * does not, then fewer problems, then more edits placed; a tie goes to the later one, which was
 * written knowing what was wrong.
 */
function better(next: Attempt, kept: Attempt | null): boolean {
  if (!kept) return true;
  const rank = (attempt: Attempt): number[] => [attempt.parsed.problems.length > 0 ? 1 : 0, attempt.problems.length, -attempt.placed.length];
  const [a, b] = [rank(next), rank(kept)];
  const at = a.findIndex((value, index) => value !== b[index]);
  return at < 0 || a[at] < b[at];
}

function failureMessage(result: Extract<DocAssistantResult, { ok: false }>): string {
  const { t } = useI18nStore.getState();
  if (result.reason === 'tooLong') return t('notion.assistant.error.tooLong');
  if (result.reason === 'empty') return t('notion.assistant.error.empty');
  return result.error || t('notion.assistant.error.failed');
}

/**
 * One turn: the user's message goes to the model with the whole document. A reply that breaks the
 * format, or names a place that is not in the document (or not in one place), goes back with what
 * was wrong, up to ASSISTANT_MAX_ATTEMPTS in all; the best reply is kept, what still could not be
 * placed is listed apart. The edits go into the document at once, in one save the user can undo
 * (the document marks them until they are synced); with the editor open they wait to be applied.
 */
export async function sendAssistantMessage(path: string, message: string): Promise<void> {
  const store = useDocAssistantStore.getState();
  const thread = threadOf(store.threads, path);
  const doc = openDocument(path);
  const text = message.trim();
  if (!doc || !text || thread.job) return;

  const history = historyOf(thread.messages);
  const selection = thread.selection;
  store.addMessage(path, { id: nextId('u'), role: 'user', text, ...(selection ? { quote: selection.text } : {}) });
  store.patch(path, { selection: null, error: null });

  const providerUrl = await ensureWritingModel();
  const document = doc.body;
  let best: Attempt | null = null;
  let retry: DocAssistantRetry | undefined;
  for (let attempt = 1; attempt <= ASSISTANT_MAX_ATTEMPTS; attempt++) {
    const requestId = nextId('a');
    useDocAssistantStore.getState().patch(path, { job: { requestId, phase: attempt === 1 ? 'running' : 'retrying', attempt } });
    const result: DocAssistantResult = await docAssistantApi.run({
      id: requestId,
      providerUrl,
      title: doc.title,
      document,
      ...(selection ? { selection: selection.source ?? selection.text } : {}),
      history,
      message: text,
      ...(retry ? { retry } : {}),
    }).catch(() => ({ ok: false as const, reason: 'failed' as const }));

    // Cancelled, or the panel was cleared: whatever came back belongs to nothing now.
    if (threadOf(useDocAssistantStore.getState().threads, path).job?.requestId !== requestId) return;
    if (!result.ok) {
      if (result.reason === 'cancelled') {
        useDocAssistantStore.getState().patch(path, { job: null });
        return;
      }
      // A failed retry still leaves the reply before it, which is better than nothing.
      if (best) break;
      useDocAssistantStore.getState().patch(path, { job: null, error: { message: failureMessage(result), retry: text } });
      return;
    }
    const judged = judge(document, result.reply);
    if (better(judged, best)) best = judged;
    if (judged.problems.length === 0) break;
    retry = { reply: result.reply, problems: judged.problems };
  }

  const done = useDocAssistantStore.getState();
  done.patch(path, { job: null });
  if (!best) return;
  const messageId = nextId('m');
  const edits: AssistantEditCard[] = best.placed.map((edit) => ({ ...edit, id: nextId('e'), state: 'pending', heading: headingAbove(document, edit.start) }));
  done.addMessage(path, { id: messageId, role: 'assistant', text: best.parsed.message, ask: best.parsed.ask, edits, unplaced: best.unplaced });
  // Saving under an open editor would throw its draft away: the edits wait for it to close.
  if (edits.length > 0 && !useAnswerEditStore.getState().drafts[draftKey(path, 0)]) {
    await applyAssistantEdits(path, messageId, edits.map((edit) => edit.id));
  }
}

export function cancelAssistant(path: string): void {
  const job = threadOf(useDocAssistantStore.getState().threads, path).job;
  if (job) void docAssistantApi.cancel(job.requestId);
  useDocAssistantStore.getState().patch(path, { job: null });
}

/** Follows the window's queue: "waiting behind another request" until this one's turn comes. */
export function subscribeAssistantProgress(): () => void {
  return docAssistantApi.onProgress(({ id, phase }) => {
    const { threads, patch } = useDocAssistantStore.getState();
    for (const [path, thread] of Object.entries(threads)) {
      const job = thread.job;
      if (job?.requestId !== id) continue;
      patch(path, { job: { ...job, phase: phase === 'waiting' ? 'waiting' : job.attempt > 1 ? 'retrying' : 'running' } });
    }
  });
}

/** The save every apply and undo goes through: one write, compared with the text it started from. */
async function saveDocument(path: string, doc: NonNullable<ReturnType<typeof openDocument>>, body: string): Promise<boolean> {
  const written = await writeAnswer({
    path, turnIndex: 0, turnCount: doc.turnCount, editedAt: doc.editedAt, expected: doc.body, response: body,
  });
  if (written.ok) return true;
  if (written.reason === 'conflict') void reloadOpenConversation();
  const { t } = useI18nStore.getState();
  showAppNotice({ level: 'error', message: t(written.reason === 'conflict' || written.reason === 'missing' ? 'notion.assistant.applyChanged' : 'notion.assistant.applyFailed') });
  return false;
}

function messageOf(path: string, messageId: string): AssistantMessage | undefined {
  return threadOf(useDocAssistantStore.getState().threads, path).messages.find((entry) => entry.id === messageId);
}

/**
 * Puts the chosen edits of one reply into the document, in one save (with undo, like an edit).
 * Each is found where it was proposed, moved by the edits of the same reply already in, or — when
 * the document changed around it — at the one place its text now is. One whose text is gone is
 * marked out of date and left alone. Where each went is kept, for undo.
 */
export async function applyAssistantEdits(path: string, messageId: string, editIds: readonly string[]): Promise<void> {
  const doc = openDocument(path);
  const message = messageOf(path, messageId);
  if (!doc || !message?.edits) return;
  const chosen = message.edits.filter((edit) => editIds.includes(edit.id) && edit.state === 'pending');
  const result = applyEdits(doc.body, chosen, message.edits.filter((edit) => edit.state === 'applied'));
  if (result.stale.length) useDocAssistantStore.getState().setEditState(path, messageId, result.stale, 'stale');
  const done = Object.keys(result.spots);
  if (done.length === 0 || !await saveDocument(path, doc, result.document)) return;
  useDocAssistantStore.getState().setEditState(path, messageId, done, 'applied', result.spots);
}

/**
 * Takes applied edits back out, in one save: each one's text goes back to what it replaced, found
 * where it went or by the text around it. One changed since (by hand, or by Notion) is left as it
 * is and marked out of date.
 */
export async function revertAssistantEdits(path: string, messageId: string, editIds: readonly string[]): Promise<void> {
  const doc = openDocument(path);
  const message = messageOf(path, messageId);
  if (!doc || !message?.edits) return;
  const chosen = message.edits.filter((edit): edit is AssistantEditCard & { applied: AppliedSpot } => (
    editIds.includes(edit.id) && edit.state === 'applied' && edit.applied !== undefined
  ));
  const result = revertEdits(doc.body, chosen);
  if (result.stale.length) useDocAssistantStore.getState().setEditState(path, messageId, result.stale, 'stale');
  if (result.reverted.length === 0 || !await saveDocument(path, doc, result.document)) return;
  useDocAssistantStore.getState().setEditState(path, messageId, result.reverted, 'reverted');
}

export function skipAssistantEdits(path: string, messageId: string, editIds: readonly string[]): void {
  useDocAssistantStore.getState().setEditState(path, messageId, editIds, 'skipped');
}

/** A passage the user selected on the page, to talk about: traced to the text as written where it can be. */
export function quoteIntoAssistant(path: string, text: string): void {
  const doc = openDocument(path);
  const words = text.trim();
  if (!doc || !words) return;
  const range = locateNotionSelection(doc.body, words, {}, displayLabels());
  const store = useDocAssistantStore.getState();
  store.patch(path, { selection: { text: words, source: range ? doc.body.slice(range.start, range.end) : null } });
  store.setOpen(true);
}

const HIGHLIGHT_TARGET = 'yobi-assistant-target';
let highlightTimer: number | undefined;

/** The text an edit card points at on the page: what it wrote once in, what it would replace before. */
function passageOf(edit: AssistantEditCard): string {
  return edit.state === 'applied' ? edit.after : edit.before;
}

/** Marks an edit's passage while the pointer is on its card; the page does not move. */
export function highlightEdit(container: HTMLElement | null, edit: AssistantEditCard | null): void {
  window.clearTimeout(highlightTimer);
  setHighlight(HIGHLIGHT_TARGET, edit ? findPassage(container, passageOf(edit)) : null);
}

/** Scrolls the document to an edit's passage and marks it for a moment. */
export function revealEdit(container: HTMLElement | null, edit: AssistantEditCard): boolean {
  // A removal once applied has no text left on the page to show.
  const range = findPassage(container, passageOf(edit));
  if (!range) return false;
  range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setHighlight(HIGHLIGHT_TARGET, range);
  window.clearTimeout(highlightTimer);
  highlightTimer = window.setTimeout(() => setHighlight(HIGHLIGHT_TARGET, null), 2_400);
  return true;
}
