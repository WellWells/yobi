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

export async function commitConversationTurn(args: {
  filePath: string;
  turn: { prompt: string; response: string; meta: TurnMeta };
  thread: ThreadMeta;
}): Promise<void> {
  const raw = await fs.readFile(args.filePath, 'utf-8');
  const withTurn = appendTurn(raw, args.turn, currentTurnLabels());
  await writeAtomic(args.filePath, writeThreadMeta(withTurn, args.thread));
}
