import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}`,
  );
  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err: unknown) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function appendConversationTurn(
  filePath: string,
  turn: { prompt: string; response: string; meta: TurnMeta },
): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  await writeAtomic(filePath, appendTurn(raw, turn, currentTurnLabels()));
}

export async function updateConversationThread(filePath: string, meta: ThreadMeta): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  await writeAtomic(filePath, writeThreadMeta(raw, meta));
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
  // `writeThreadMeta` puts the marker under the h1, and PREPENDS it as line 1 when there is no
  // h1 to sit under. The sidebar preview is the file's first 200 characters, so on a file that
  // never had a title the preview would become a raw HTML comment. Every conversation Yobi
  // wrote has a title; a markdown file the user dropped into the output folder may not, and
  // this writer runs against whatever file is open rather than only files Yobi created.
  if (!H1_LINE.test(raw) && !THREAD_MARKER_LINE.test(raw)) return;
  const current = parseConversationDoc(raw, await conversationAliases()).thread;
  await writeAtomic(filePath, writeThreadMeta(raw, { ...current, ...patch, v: 1 }));
}

export async function commitConversationTurn(args: {
  filePath: string;
  turn: { prompt: string; response: string; meta: TurnMeta };
  thread: ThreadMeta;
}): Promise<void> {
  const raw = await fs.readFile(args.filePath, 'utf-8');
  const withTurn = appendTurn(raw, args.turn, currentTurnLabels());
  await writeAtomic(args.filePath, writeThreadMeta(withTurn, args.thread));
}
