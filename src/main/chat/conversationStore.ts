import * as fs from 'node:fs/promises';
import {
  appendTurn,
  hasThreadMetaAnchor,
  parseConversationDoc,
  replaceTurnMeta,
  replaceTurnResponse,
  writeThreadMeta,
} from '../../shared/conversationDoc';
import type { TurnTranslationRequest, TurnTranslationResult } from '../../shared/translate';
import type {
  ConversationDoc,
  ConversationHeadingAliases,
  ThreadMeta,
  TurnMeta,
} from '../../shared/conversationDoc';
import type { ResponseEditRequest, ResponseEditResult } from '../../shared/types';
import { keepConversationId, withConversationId } from '../../shared/conversationHistory';
import { keepPinState } from '../../shared/conversationPin';
import { notionDocParts, writeNotionDoc } from '../../shared/notion/notionDoc';
import { writeFileAtomic } from '../atomicWrite';
import { conversationPathKey } from '../conversationPaths';
import { newConversationId, recordConversationVersion } from '../history/conversationHistory';
import { loadMarkdownHeadingAliases } from '../files';
import { getLangCache, t } from '../i18n';

export interface LoadedConversation {
  raw: string;
  doc: ConversationDoc;
}

export function conversationAliases(): Promise<ConversationHeadingAliases> {
  return loadMarkdownHeadingAliases();
}

function label(strings: Record<string, string>, key: string, fallback: string): string {
  const value = t(strings, key);
  return value && value !== key ? value : fallback;
}

export function currentTurnLabels(): { prompt: string; response: string } {
  const strings = getLangCache();
  return {
    prompt: label(strings, 'md.prompt', 'Prompt'),
    response: label(strings, 'md.response', 'Response'),
  };
}

export async function loadConversation(filePath: string): Promise<LoadedConversation | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const doc = parseConversationDoc(raw, await conversationAliases());
    return { raw, doc };
  } catch {
    return null;
  }
}

const fileChains = new Map<string, Promise<void>>();

/**
 * Runs one read-modify-write of a conversation file after every earlier one on the same file. An
 * answer landing while the user saves an edit would otherwise be written over by whichever wrote
 * second, and two renames onto one file fail with EPERM on Windows.
 */
export function withConversationFile<T>(filePath: string, work: () => Promise<T>): Promise<T> {
  const key = conversationPathKey(filePath);
  const run = (fileChains.get(key) ?? Promise.resolve()).then(work);
  const tail = run.then(() => undefined, () => undefined);
  fileChains.set(key, tail);
  void tail.then(() => {
    if (fileChains.get(key) === tail) fileChains.delete(key);
  });
  return run;
}

export function appendConversationTurn(
  filePath: string,
  turn: { prompt: string; response: string; meta: TurnMeta },
): Promise<void> {
  return withConversationFile(filePath, async () => {
    const raw = await fs.readFile(filePath, 'utf-8');
    await writeFileAtomic(filePath, appendTurn(raw, turn, currentTurnLabels()));
  });
}

/**
 * The caller's marker replaces the file's whole, except for the id and the pin: a send that began
 * before either was given must not erase it.
 */
export function updateConversationThread(filePath: string, meta: ThreadMeta): Promise<void> {
  return withConversationFile(filePath, async () => {
    const raw = await fs.readFile(filePath, 'utf-8');
    await writeFileAtomic(filePath, writeThreadMeta(raw, keepPinState(raw, keepConversationId(raw, meta))));
  });
}

/** Far above any answer a provider returns; it only stops a runaway payload. */
const EDITED_RESPONSE_MAX_CHARS = 2_000_000;

/** The renderer's edit request, or null when any field is off. */
export function parseResponseEditRequest(value: unknown): ResponseEditRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { filePath, turnIndex, expected, response, editedAt } = value as Record<string, unknown>;
  if (typeof filePath !== 'string' || !filePath) return null;
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) return null;
  if (typeof expected !== 'string' || typeof response !== 'string') return null;
  // An empty answer would drop the turn out of every replay; deleting a turn is not this action.
  if (!response.trim() || response.length > EDITED_RESPONSE_MAX_CHARS) return null;
  if (editedAt !== undefined && editedAt !== null
    && (typeof editedAt !== 'string' || Number.isNaN(Date.parse(editedAt)))) return null;
  return {
    filePath,
    turnIndex,
    expected,
    response,
    ...(editedAt === undefined ? {} : { editedAt }),
  };
}

/**
 * Replaces one turn's answer with the user's edit. `expected` is the answer the editor started
 * from: when the file says something else (another app changed it, or the turn moved), nothing is
 * written. `editedAt` defaults to now; undo passes back the turn's previous value, `null` for
 * a turn that had never been edited.
 *
 * An edited turn that the rolling summary already covers drops the summary, so the next replay
 * summarises the edited text instead of the original.
 */
export function editConversationResponse(args: ResponseEditRequest): Promise<ResponseEditResult> {
  return withConversationFile(args.filePath, async (): Promise<ResponseEditResult> => {
    const raw = await fs.readFile(args.filePath, 'utf-8');
    const notionDoc = notionDocParts(raw);
    if (notionDoc) return editNotionDocBody(args, raw, notionDoc.body);
    const aliases = await conversationAliases();
    const doc = parseConversationDoc(raw, aliases);
    const turn = doc.turns[args.turnIndex];
    if (!turn) return { ok: false, reason: 'missing' };
    if (turn.response.trim() !== args.expected.trim()) return { ok: false, reason: 'conflict' };

    const { ed: _previous, ...rest } = turn.meta;
    const editedAt = args.editedAt === undefined ? new Date().toISOString() : args.editedAt;
    const meta: TurnMeta = editedAt ? { ...rest, ed: editedAt } : rest;
    let next = replaceTurnResponse(raw, aliases, args.turnIndex, args.response, meta);
    if (next === null) return { ok: false, reason: 'failed' };

    if ((doc.thread.summarizedTurns ?? 0) > args.turnIndex) {
      const { summary: _summary, summarizedTurns: _covered, ...thread } = doc.thread;
      next = writeThreadMeta(next, thread);
    }
    // The text before the edit is kept as a version, under the id the file gets now if it had none.
    const versioned = withConversationId(next, newConversationId);
    if (versioned) {
      next = versioned.raw;
      await recordConversationVersion(versioned.id, raw, 'edit');
    }
    await writeFileAtomic(args.filePath, next);
    return { ok: true, content: next };
  });
}

/**
 * A Notion document is edited as one answer (turn 0, the body): the editor and the rewrite tools
 * work on it unchanged, and the text before the save is kept as a version. Nothing goes to Notion
 * here; the document view offers what changed for the user to send.
 */
async function editNotionDocBody(args: ResponseEditRequest, raw: string, body: string): Promise<ResponseEditResult> {
  if (args.turnIndex !== 0) return { ok: false, reason: 'missing' };
  if (body.trim() !== args.expected.trim()) return { ok: false, reason: 'conflict' };
  const next = writeNotionDoc(raw, { body: args.response, at: new Date().toISOString() });
  if (next === null) return { ok: false, reason: 'failed' };
  const versioned = withConversationId(next, newConversationId);
  if (versioned) await recordConversationVersion(versioned.id, raw, 'edit');
  const content = versioned?.raw ?? next;
  await writeFileAtomic(args.filePath, content);
  return { ok: true, content };
}

/**
 * Sets or removes one turn's translation (`tr`). Only that turn's marker changes: a translation is
 * not an edit (no `ed`, no version), the model never sees it (the summary and `threadTurns` stay),
 * and the answer's text is left byte for byte. `expected` is the answer the translation was made
 * from; when the file says something else, nothing is written.
 */
export function setTurnTranslation(args: TurnTranslationRequest): Promise<TurnTranslationResult> {
  return withConversationFile(args.filePath, async (): Promise<TurnTranslationResult> => {
    const raw = await fs.readFile(args.filePath, 'utf-8');
    const aliases = await conversationAliases();
    const turn = parseConversationDoc(raw, aliases).turns[args.turnIndex];
    if (!turn) return { ok: false, reason: 'missing' };
    if (turn.response.trim() !== args.expected.trim()) return { ok: false, reason: 'conflict' };
    const { tr: _previous, ...rest } = turn.meta;
    const next = replaceTurnMeta(raw, aliases, args.turnIndex, args.tr ? { ...rest, tr: args.tr } : rest);
    if (next === null) return { ok: false, reason: 'failed' };
    await writeFileAtomic(args.filePath, next);
    return { ok: true, content: next };
  });
}

/**
 * Read-modify-write one part of the thread marker.
 *
 * `updateConversationThread` replaces the whole marker from the caller's snapshot, which is
 * correct for the chat turn runner (it owns every field) and wrong for anyone touching a single
 * one: a command run that takes minutes would write back a `threadUrl` and `threadTurns` from
 * before the turn it is landing beside, and native continuation would silently fall back to
 * replay.
 */
export function mergeConversationThread(
  filePath: string,
  patch: Partial<Omit<ThreadMeta, 'v'>>,
): Promise<void> {
  return withConversationFile(filePath, async () => {
    const raw = await fs.readFile(filePath, 'utf-8');
    // Without an h1, `writeThreadMeta` prepends the marker as line 1 and the sidebar preview (first 200
    // chars) would show a raw HTML comment; user-dropped files may lack a title.
    if (!hasThreadMetaAnchor(raw)) return;
    const current = parseConversationDoc(raw, await conversationAliases()).thread;
    await writeFileAtomic(filePath, writeThreadMeta(raw, { ...current, ...patch, v: 1 }));
  });
}

export function commitConversationTurn(args: {
  filePath: string;
  turn: { prompt: string; response: string; meta: TurnMeta };
  thread: ThreadMeta;
}): Promise<void> {
  return withConversationFile(args.filePath, async () => {
    const raw = await fs.readFile(args.filePath, 'utf-8');
    const withTurn = appendTurn(raw, args.turn, currentTurnLabels());
    await writeFileAtomic(args.filePath, writeThreadMeta(withTurn, keepPinState(raw, keepConversationId(raw, args.thread))));
  });
}
