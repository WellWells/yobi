import { notionBlockRanges } from './notion/notionBlocks';

/**
 * The writing assistant: a side panel beside a Notion document where the user says what to do
 * with it. One fixed prompt, one reply in a fixed format — a message, then either a question or
 * the places to change as find/replace pairs. The changes go into the local document at once, each
 * one undoable, and Notion only hears of them when the user syncs. Not the agent: there are no
 * tools to run, only a format to keep, and a reply that does not keep it is sent back with what
 * was wrong.
 */

export interface DocAssistantTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface DocAssistantRetry {
  /** The reply that could not be used, as the model wrote it. */
  reply: string;
  /** What was wrong with it, in words for the model. */
  problems: string[];
}

export interface DocAssistantRequest {
  /** Chosen by the renderer; progress events and cancel name the request by it. */
  id: string;
  providerUrl: string;
  title: string;
  /** The document as written (Notion's Markdown), the text every FIND is matched against. */
  document: string;
  /** The passage the user pointed at, as written where it could be traced. */
  selection?: string;
  /** Earlier turns of this panel's conversation, oldest first. */
  history: DocAssistantTurn[];
  message: string;
  retry?: DocAssistantRetry;
}

export type DocAssistantFailure = 'cancelled' | 'tooLong' | 'empty' | 'failed' | 'invalid';

export type DocAssistantResult =
  | { ok: true; reply: string; providerUrl: string }
  | { ok: false; reason: DocAssistantFailure; error?: string };

export interface DocAssistantProgress {
  id: string;
  phase: 'waiting' | 'running';
}

export const DOC_ASSISTANT_DOCUMENT_MAX_CHARS = 200_000;
export const DOC_ASSISTANT_MESSAGE_MAX_CHARS = 4_000;
const SELECTION_MAX_CHARS = 20_000;
const HISTORY_MAX_TURNS = 20;
const TURN_MAX_CHARS = 8_000;
const RETRY_MAX_CHARS = 60_000;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** The renderer's request, or null when any field is off. */
export function parseDocAssistantRequest(value: unknown): DocAssistantRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 100);
  const providerUrl = text(raw.providerUrl, 2_000)?.trim();
  const title = text(raw.title, 2_000) ?? '';
  const document = text(raw.document, DOC_ASSISTANT_DOCUMENT_MAX_CHARS);
  const message = text(raw.message, DOC_ASSISTANT_MESSAGE_MAX_CHARS)?.trim();
  if (!id || !providerUrl || document === null || !message) return null;
  const selection = raw.selection === undefined ? '' : text(raw.selection, SELECTION_MAX_CHARS);
  if (selection === null) return null;
  if (!Array.isArray(raw.history)) return null;
  const history: DocAssistantTurn[] = [];
  for (const turn of raw.history.slice(-HISTORY_MAX_TURNS)) {
    const { role, text: said } = (turn ?? {}) as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof said !== 'string') return null;
    history.push({ role, text: said.slice(0, TURN_MAX_CHARS) });
  }
  let retry: DocAssistantRetry | undefined;
  if (raw.retry !== undefined) {
    const { reply, problems } = (raw.retry ?? {}) as Record<string, unknown>;
    const previous = text(reply, RETRY_MAX_CHARS);
    if (previous === null || !Array.isArray(problems) || !problems.every((problem) => typeof problem === 'string')) return null;
    retry = { reply: previous, problems: (problems as string[]).slice(0, 20).map((problem) => problem.slice(0, 500)) };
  }
  return {
    id,
    providerUrl,
    title,
    document,
    ...(selection.trim() ? { selection } : {}),
    history,
    message,
    ...(retry ? { retry } : {}),
  };
}

// --- The reply ---------------------------------------------------------------------------------

export interface AssistantQuestion {
  question: string;
  options: string[];
}

export interface AssistantEdit {
  find: string;
  replace: string;
}

export interface ParsedAssistantReply {
  /** The message to the user. */
  message: string;
  ask: AssistantQuestion | null;
  edits: AssistantEdit[];
  /** What keeps the reply from being used as it is, in words for the model. */
  problems: string[];
}

type Mark = 'REPLY' | 'ASK' | 'FIND' | 'REPLACE';

// A web page may render a mark in bold, or the model may follow it with a colon.
const MARK_LINE = /^[ \t]*(?:\*\*|__)?\[(REPLY|ASK|FIND|REPLACE)\](?:\*\*|__)?[ \t]*:?[ \t]*(.*)$/i;
const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})[^\n]*$/;

/** One code block wrapped around the whole of a FIND or REPLACE comes off; the text inside stays as it is. */
function unfence(body: string): string {
  const lines = body.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const open = FENCE_OPEN.exec(lines[0] ?? '');
  if (open && lines.length >= 2) {
    const fence = open[1];
    const close = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    if (close.test(lines.at(-1)!)) return lines.slice(1, -1).join('\n');
  }
  return lines.join('\n');
}

const OPTION_LINE = /^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+(.+)$/;

/**
 * The reply in its parts. Whatever is wrong is listed for the model to fix; a reply with no marks
 * at all is a message (and a problem, since the format was asked for).
 */
export function parseAssistantReply(raw: string): ParsedAssistantReply {
  const sections: Array<{ mark: Mark; lines: string[] }> = [];
  const lead: string[] = [];
  let inFence: string | null = null;
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    // A mark inside a FIND or REPLACE code block is the document's text, not a new section.
    const fence = FENCE_OPEN.exec(line)?.[1];
    if (inFence) {
      if (new RegExp(`^[ \\t]*${inFence[0] === '`' ? '`' : '~'}{${inFence.length},}[ \\t]*$`).test(line)) inFence = null;
      (sections.at(-1)?.lines ?? lead).push(line);
      continue;
    }
    const mark = MARK_LINE.exec(line);
    if (mark) {
      sections.push({ mark: mark[1].toUpperCase() as Mark, lines: mark[2] ? [mark[2]] : [] });
      continue;
    }
    if (fence) inFence = fence;
    (sections.at(-1)?.lines ?? lead).push(line);
  }

  if (sections.length === 0) {
    return { message: raw.trim(), ask: null, edits: [], problems: ['The reply does not follow the format: it must start with [REPLY].'] };
  }

  const problems: string[] = [];
  const messages: string[] = [];
  let ask: AssistantQuestion | null = null;
  const edits: AssistantEdit[] = [];
  let find: string | null = null;
  if (lead.join('\n').trim()) messages.push(lead.join('\n').trim());
  if (sections[0].mark !== 'REPLY') problems.push('The reply must start with [REPLY].');

  for (const { mark, lines } of sections) {
    const body = lines.join('\n');
    if (mark === 'REPLY') {
      if (body.trim()) messages.push(body.trim());
    } else if (mark === 'ASK') {
      const question: string[] = [];
      const options: string[] = [];
      for (const line of body.split('\n')) {
        const option = OPTION_LINE.exec(line);
        if (option && question.length > 0) options.push(option[1].trim());
        else if (line.trim()) question.push(line.trim());
      }
      if (question.length === 0) problems.push('[ASK] has no question.');
      else ask = { question: question.join('\n'), options };
    } else if (mark === 'FIND') {
      if (find !== null) problems.push(`[FIND] #${edits.length + 1} has no [REPLACE] after it.`);
      find = unfence(body);
      if (!find.trim()) problems.push(`[FIND] #${edits.length + 1} is empty: copy the lines to change from the document.`);
    } else if (find === null) {
      problems.push(`[REPLACE] #${edits.length + 1} has no [FIND] before it.`);
    } else {
      if (find.trim()) edits.push({ find, replace: unfence(body) });
      find = null;
    }
  }
  if (find !== null) problems.push(`[FIND] #${edits.length + 1} has no [REPLACE] after it.`);
  if (ask && edits.length > 0) problems.push('Either ask a question or propose edits, not both: ask only when you cannot edit without the answer.');
  const message = messages.join('\n\n');
  if (!message) problems.push('[REPLY] is empty: say in a sentence or two what you did or found.');
  return { message, ask, edits, problems };
}

// --- Placing edits -----------------------------------------------------------------------------

export interface PlacedEdit {
  start: number;
  end: number;
  /** The document's text there, as written (may differ from FIND in spacing or Markdown). */
  before: string;
  after: string;
}

export interface UnplacedEdit extends AssistantEdit {
  reason: 'missing' | 'ambiguous' | 'locked' | 'overlap' | 'unchanged';
}

/** Where a FIND sits by what the page shows (Notion's display), for a FIND whose Markdown differs. */
export type VisibleLocator = (find: string) => { start: number; end: number } | null;

type Found = { start: number; end: number } | 'missing' | 'ambiguous';

function exactly(document: string, find: string): Found {
  const at = document.indexOf(find);
  if (at < 0) return 'missing';
  return document.indexOf(find, at + 1) >= 0 ? 'ambiguous' : { start: at, end: at + find.length };
}

/** The same characters with any whitespace between them: tabs written as spaces, a blank line left out. */
function ignoringSpace(document: string, find: string): Found {
  const chars: string[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < document.length; i++) {
    if (/\s/.test(document[i])) continue;
    chars.push(document[i]);
    offsets.push(i);
  }
  const skeleton = chars.join('');
  const needle = find.replace(/\s+/g, '');
  if (!needle) return 'missing';
  const at = skeleton.indexOf(needle);
  if (at < 0) return 'missing';
  if (skeleton.indexOf(needle, at + 1) >= 0) return 'ambiguous';
  return { start: offsets[at], end: offsets[at + needle.length - 1] + 1 };
}

function lockedRanges(document: string): Array<{ start: number; end: number }> {
  return notionBlockRanges(document).filter((block) => block.kind === 'locked');
}

/**
 * Each edit's place in the document: the exact text first, then the same characters with other
 * spacing, then (given) the text as the page shows it. An edit is left out — and named for the
 * model — when its text is nowhere, in more than one place, in a block edited in Notion, over
 * another edit, or not a change at all. Placed edits come in document order.
 */
export function placeEdits(document: string, edits: readonly AssistantEdit[], visible?: VisibleLocator): {
  placed: PlacedEdit[];
  unplaced: UnplacedEdit[];
  problems: string[];
} {
  const placed: Array<PlacedEdit & { index: number }> = [];
  const unplaced: UnplacedEdit[] = [];
  const problems: string[] = [];
  const locked = lockedRanges(document);
  edits.forEach((edit, index) => {
    const n = index + 1;
    let found = exactly(document, edit.find);
    if (found === 'missing') found = ignoringSpace(document, edit.find);
    if (found === 'missing' && visible) found = visible(edit.find) ?? 'missing';
    if (found === 'missing') {
      unplaced.push({ ...edit, reason: 'missing' });
      problems.push(`[FIND] #${n} is not in the document: copy it character for character from the document.`);
      return;
    }
    if (found === 'ambiguous') {
      unplaced.push({ ...edit, reason: 'ambiguous' });
      problems.push(`[FIND] #${n} appears more than once in the document: add a neighbouring line so it matches one place.`);
      return;
    }
    const range = found;
    if (locked.some((block) => block.start < Math.max(range.end, range.start + 1) && range.start < block.end)) {
      unplaced.push({ ...edit, reason: 'locked' });
      problems.push(`[FIND] #${n} is in a table, child page, database or other block that is edited in Notion: leave it out.`);
      return;
    }
    const before = document.slice(range.start, range.end);
    if (before === edit.replace) {
      unplaced.push({ ...edit, reason: 'unchanged' });
      problems.push(`[FIND] #${n} and its [REPLACE] are the same: leave out a place you do not change.`);
      return;
    }
    const other = placed.find((edit2) => edit2.start < range.end && range.start < edit2.end);
    if (other) {
      unplaced.push({ ...edit, reason: 'overlap' });
      problems.push(`[FIND] #${n} overlaps [FIND] #${other.index + 1}: make them one pair.`);
      return;
    }
    placed.push({ start: range.start, end: range.end, before, after: edit.replace, index });
  });
  placed.sort((a, b) => a.start - b.start);
  return { placed: placed.map(({ index: _index, ...edit }) => edit), unplaced, problems };
}

/**
 * Both sides of an edit without the indentation they share, to show them: a nested item's lines
 * start with tabs, and on their own (outside their list) Markdown reads that as a code block.
 */
export function dedentPair(before: string, after: string): [string, string] {
  const indentOf = (line: string): number => /^[ \t]*/.exec(line)![0].length;
  const lines = [...before.split('\n'), ...after.split('\n')].filter((line) => line.trim());
  const indent = lines.length ? Math.min(...lines.map(indentOf)) : 0;
  if (indent === 0) return [before, after];
  const cut = (text: string): string => text.split('\n').map((line) => line.slice(Math.min(indent, indentOf(line)))).join('\n');
  return [cut(before), cut(after)];
}

/** Where an applied edit went: its offset, with a little of the text around it to find it again. */
export interface AppliedSpot {
  at: number;
  left: string;
  right: string;
}

export interface EditToApply extends PlacedEdit {
  id: string;
}

/** How much of the text around an applied edit is kept to find it again. */
const SPOT_CONTEXT = 40;

/** The one place `needle` is in `text`; -1 when it is not there or there more than once. */
function uniqueIndex(text: string, needle: string): number {
  if (!needle) return -1;
  const at = text.indexOf(needle);
  return at >= 0 && text.indexOf(needle, at + 1) < 0 ? at : -1;
}

/**
 * `edits` put into `document`, which already holds `already` (edits of the same reply applied
 * before). Each goes where it was proposed, moved by those before it, or — when the document changed
 * around it — at the one place its text now is; one whose text is gone is `stale` and left out.
 * Where each went is in `spots`, read off the final text.
 */
export function applyEdits(
  document: string, edits: readonly EditToApply[], already: readonly PlacedEdit[],
): { document: string; spots: Record<string, AppliedSpot>; stale: string[] } {
  let text = document;
  const placed: Array<{ edit: EditToApply; at: number }> = [];
  const stale: string[] = [];
  // First to last: each moves the ones after it by what it added or took away.
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    const shift = [...already, ...placed.map((entry) => entry.edit)]
      .filter((other) => other.start < edit.start)
      .reduce((sum, other) => sum + other.after.length - other.before.length, 0);
    const shifted = edit.start + shift;
    const at = text.slice(shifted, shifted + edit.before.length) === edit.before ? shifted : uniqueIndex(text, edit.before);
    if (at < 0) {
      stale.push(edit.id);
      continue;
    }
    text = text.slice(0, at) + edit.after + text.slice(at + edit.before.length);
    // One placed by its text alone may land before those already in: they move by what it changed.
    for (const entry of placed) if (entry.at >= at) entry.at += edit.after.length - edit.before.length;
    placed.push({ edit, at });
  }
  const spots = Object.fromEntries(placed.map(({ edit, at }) => [edit.id, {
    at,
    left: text.slice(Math.max(0, at - SPOT_CONTEXT), at),
    right: text.slice(at + edit.after.length, at + edit.after.length + SPOT_CONTEXT),
  }]));
  return { document: text, spots, stale };
}

/**
 * Where an applied edit's text is now: where it went, else the one place it sits with what was
 * around it. One side of that may have changed since (a neighbouring edit, a word typed next to
 * it); the other side still places it, if only once.
 */
function findApplied(document: string, edit: EditToApply & { applied: AppliedSpot }): number {
  const { at, left, right } = edit.applied;
  const { after } = edit;
  const leftFits = (pos: number): boolean => document.slice(pos - left.length, pos) === left;
  const rightFits = (pos: number): boolean => document.slice(pos + after.length, pos + after.length + right.length) === right;
  if (document.slice(at, at + after.length) === after && (leftFits(at) || rightFits(at))) return at;
  const candidates: Array<[string, number]> = [[`${left}${after}${right}`, left.length], [`${left}${after}`, left.length], [`${after}${right}`, 0]];
  for (const [needle, offset] of candidates) {
    const found = uniqueIndex(document, needle);
    if (found >= 0) return found + offset;
  }
  return -1;
}

/**
 * Applied edits taken back out: each one's text goes back to what it replaced. One whose text (or
 * what was around it) changed since is `stale` and left as it is.
 */
export function revertEdits(
  document: string, edits: ReadonlyArray<EditToApply & { applied: AppliedSpot }>,
): { document: string; reverted: string[]; stale: string[] } {
  const found: Array<{ edit: EditToApply; at: number }> = [];
  const stale: string[] = [];
  for (const edit of edits) {
    const at = findApplied(document, edit);
    if (at < 0) stale.push(edit.id);
    else found.push({ edit, at });
  }
  let text = document;
  // Last first: taking one out never moves those before it.
  for (const { edit, at } of [...found].sort((a, b) => b.at - a.at)) {
    text = text.slice(0, at) + edit.before + text.slice(at + edit.after.length);
  }
  return { document: text, reverted: found.map((entry) => entry.edit.id), stale };
}
