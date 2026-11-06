import * as path from 'node:path';
import type { AgentRunState } from '../../shared/types';
import type { ConversationTurn } from '../../shared/conversationDoc';
import type { ExportFile, ExportSourceKind } from '../flow/agent/agentExportFile';
import { saveRunState } from '../flow/agent/agentRunStore';
import { getProviderLabel } from '../providers';
import { exportAnswerFile } from './answerExport';
import type { AnswerExportSource } from './answerExport';
import { inChatMedia } from './agentPictures';
import { loadConversation } from './conversationStore';

/*
 * `/agent`'s files: what `export_file` renders waits on the run's state for the answer, as a
 * drawn picture does, so a file made before a question still goes out with the answer after it.
 */

type Source = AnswerExportSource & { from: ExportSourceKind };

const PROBE_CHARS = 16;
const MAX_PROBES = 6;

function lettersOf(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Pieces of the replied-to text, spread across it, any of which identifies the answer. */
function probesOf(letters: string): string[] {
  if (letters.length <= PROBE_CHARS) return [letters];
  const last = letters.length - PROBE_CHARS;
  const count = Math.min(MAX_PROBES, Math.ceil(letters.length / PROBE_CHARS));
  return Array.from({ length: count }, (_, i) => {
    const at = Math.round((last * i) / (count - 1));
    return letters.slice(at, at + PROBE_CHARS);
  });
}

/**
 * The answer a replied-to bot message came from. The chat shows the answer rendered — no Markdown,
 * a link as its text, tables as lines, a long one cut into messages — so it is matched on letters
 * and digits alone, link targets left out, from pieces spread across it (the start may be a table
 * row the rendering reordered). Newest first.
 */
export function answerForReply(replied: string, turns: readonly ConversationTurn[]): ConversationTurn | null {
  const letters = lettersOf(replied);
  if (!letters) return null;
  const probes = probesOf(letters);
  for (const turn of [...turns].reverse()) {
    const response = lettersOf(turn.response.replace(/\]\([^)\s]*\)/g, ']'));
    if (probes.some((probe) => response.includes(probe))) return turn;
  }
  return null;
}

function fromTurn(turn: ConversationTurn, from: ExportSourceKind): Source {
  return { markdown: turn.response, title: '', prompt: turn.prompt, provider: turn.meta.p ?? '', from };
}

/**
 * What a "make it a PDF" with no text of the model's own means: the message the user replied to
 * (the whole answer it was part of when it is the bot's own), else the last answer in this chat.
 * This run's own turns (an earlier question of it) are not an answer.
 */
export async function exportSourceFor(state: AgentRunState): Promise<Source | { missing: 'reply' | 'answer' }> {
  const doc = state.conversationPath ? (await loadConversation(state.conversationPath))?.doc : null;
  const turns = (doc?.turns ?? []).filter((turn) => turn.meta.r !== state.runId && turn.response.trim());
  const reply = state.replyTo;
  if (reply) {
    const text = reply.text.trim();
    if (!text) return { missing: 'reply' };
    const answer = reply.self ? answerForReply(text, turns) : null;
    return answer ? fromTurn(answer, 'reply') : { markdown: text, title: '', prompt: '', provider: '', from: 'reply' };
  }
  const last = turns.at(-1);
  return last ? fromTurn(last, 'answer') : { missing: 'answer' };
}

/** `export_file` for one run: renders the file and keeps it on the run's state for the answer. */
export function agentFileExporter(state: AgentRunState): ExportFile {
  return async ({ format, content, title }) => {
    const source: Source | { missing: 'reply' | 'answer' } = content
      ? { markdown: content, title, prompt: '', provider: getProviderLabel(state.providerUrl), from: 'content' }
      : await exportSourceFor(state);
    if ('missing' in source) return source;
    const file = await exportAnswerFile({ ...source, title: title || source.title }, format);
    state.documents = [...(state.documents ?? []), file.path];
    state.updatedAt = new Date().toISOString();
    await saveRunState(state);
    return { name: path.basename(file.path), format: file.format, from: source.from };
  };
}

/** The files to send with the answer; read from a run file, so only names in the chat media folder count. */
export function runDocuments(state: AgentRunState, dir?: string): string[] {
  return inChatMedia(state.documents, dir);
}
