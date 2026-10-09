import * as fs from 'node:fs/promises';
import {
  appendTurn,
  parseConversationDoc,
  writeThreadMeta,
} from '../../shared/conversationDoc';
import type {
  ConversationDoc,
  ConversationHeadingAliases,
  ThreadMeta,
  TurnMeta,
} from '../../shared/conversationDoc';
import { writeFileAtomic } from '../atomicWrite';
import { loadMarkdownHeadingAliases } from '../files';
import { getLangCache, t } from '../i18n';

const H1_LINE = /^#\s+\S/m;
const THREAD_MARKER_LINE = /^<!--\s*yobi:thread\s/m;

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

function currentTurnLabels(): { prompt: string; response: string } {
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

export async function appendConversationTurn(
  filePath: string,
  turn: { prompt: string; response: string; meta: TurnMeta },
): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  await writeFileAtomic(filePath, appendTurn(raw, turn, currentTurnLabels()));
}

export async function updateConversationThread(filePath: string, meta: ThreadMeta): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  await writeFileAtomic(filePath, writeThreadMeta(raw, meta));
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
export async function mergeConversationThread(
  filePath: string,
  patch: Partial<Omit<ThreadMeta, 'v'>>,
): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  // Without an h1, `writeThreadMeta` prepends the marker as line 1 and the sidebar preview (first 200
  // chars) would show a raw HTML comment; user-dropped files may lack a title.
  if (!H1_LINE.test(raw) && !THREAD_MARKER_LINE.test(raw)) return;
  const current = parseConversationDoc(raw, await conversationAliases()).thread;
  await writeFileAtomic(filePath, writeThreadMeta(raw, { ...current, ...patch, v: 1 }));
}

export async function commitConversationTurn(args: {
  filePath: string;
  turn: { prompt: string; response: string; meta: TurnMeta };
  thread: ThreadMeta;
}): Promise<void> {
  const raw = await fs.readFile(args.filePath, 'utf-8');
  const withTurn = appendTurn(raw, args.turn, currentTurnLabels());
  await writeFileAtomic(args.filePath, writeThreadMeta(withTurn, args.thread));
}
