import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentRunState } from '../../shared/types';
import type { ConversationTurn } from '../../shared/conversationDoc';
import type { ExportFile, ExportSourceKind, ExportedFile } from '../flow/agent/agentExportFile';
import { denyReasonForFileTool, getAgentFileRoots, resolveAgentReadPath } from '../flow/agent/agentSandbox';
import { FileToPdfError, fileToPdf } from '../pdf/fileToPdf';
import { saveRunState } from '../flow/agent/agentRunStore';
import { writeFileAtomic } from '../atomicWrite';
import { chatMediaDir } from '../chatMedia';
import { sendLog } from '../helpers';
import { getProviderLabel } from '../providers';
import { exportAnswerFile } from './answerExport';
import type { AnswerExportSource } from './answerExport';
import { inChatMedia } from './agentPictures';
import { loadConversation } from './conversationStore';
import { ConversionRefused, convertForRun } from './agentConversions';

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

async function keepDocument(state: AgentRunState, file: string): Promise<void> {
  state.documents = [...(state.documents ?? []), file];
  state.updatedAt = new Date().toISOString();
  await saveRunState(state);
}

/**
 * A file `export_file` names, as an absolute path the run may read: the same folders and the same
 * credential-name refusal as `file_read`. A run without file reads gets only its own attachments.
 */
async function readableFile(state: AgentRunState, asked: string, readsFiles: boolean): Promise<string | { refused: string }> {
  // The same permission as `file_read`: a bot account without the agent tools reads no local
  // file — but the file it sent with this very request is its own to convert.
  if (!readsFiles && !(await isRunAttachment(state, asked))) {
    return { refused: 'Local files cannot be read in this chat, so a file cannot be converted here. Tell the user.' };
  }
  const abs = await resolveAgentReadPath(asked);
  if (await denyReasonForFileTool('file_read', { path: abs }, await getAgentFileRoots())) {
    return { refused: `"${asked}" is outside the folders you may read (the app output folder, Documents, Downloads, Desktop, chat-media).` };
  }
  if (!existsSync(abs)) return { refused: `"${asked}" does not exist. Check the name with file_list; never use a different file instead.` };
  return abs;
}

/**
 * `export_file` with one "file" and "pdf": a PDF of a file the run may read, named after it, kept in
 * chat media like any answer file. Markdown goes through the card renderer, so it looks like an
 * exported answer.
 */
async function exportFileAsPdf(state: AgentRunState, abs: string, title: string): Promise<ExportedFile> {
  let made;
  try {
    made = await fileToPdf(abs);
  } catch (err) {
    if (err instanceof FileToPdfError) return { refused: err.message };
    throw err;
  }
  if ('markdown' in made) {
    const file = await exportAnswerFile({ markdown: made.markdown, title, prompt: '', provider: '' }, 'pdf');
    await keepDocument(state, file.path);
    return { name: path.basename(file.path), format: file.format, from: 'file' };
  }
  const dir = chatMediaDir();
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, keptDocumentName(state.runId, `${path.parse(abs).name}.pdf`));
  await writeFileAtomic(out, made.pdf);
  await keepDocument(state, out);
  return { name: path.basename(out), format: 'pdf', from: 'file' };
}

/** Whether `asked` names one of the files attached to this run (its chat-media copy). */
async function isRunAttachment(state: AgentRunState, asked: string): Promise<boolean> {
  if (!state.attachments?.length) return false;
  const abs = path.resolve(await resolveAgentReadPath(asked));
  const same = (file: string): boolean => (process.platform === 'win32'
    ? path.resolve(file).toLowerCase() === abs.toLowerCase()
    : path.resolve(file) === abs);
  return (state.attachments ?? []).some(same);
}

/** `export_file` for one run: renders the file and keeps it on the run's state for the answer. */
export function agentFileExporter(state: AgentRunState, access: { readsFiles: boolean } = { readsFiles: false }): ExportFile {
  return async (request) => {
    const { format, content, title, files: asked } = request;
    const files: string[] = [];
    for (const name of asked) {
      const abs = await readableFile(state, name, access.readsFiles);
      if (typeof abs !== 'string') return abs;
      files.push(abs);
    }
    if (format === 'pdf' && files.length === 1) return exportFileAsPdf(state, files[0], title);
    if (files.length > 0 || format === 'qr' || format === 'srt' || format === 'zip' || format === 'mp3') {
      const dir = chatMediaDir();
      await fs.mkdir(dir, { recursive: true });
      let made: string;
      try {
        made = await convertForRun(request, files, { pathFor: (name) => path.join(dir, keptDocumentName(state.runId, name)) });
      } catch (err) {
        if (err instanceof ConversionRefused) return { refused: err.message };
        throw err;
      }
      await keepDocument(state, made);
      return { name: path.basename(made), format: path.extname(made).slice(1).toLowerCase(), from: files.length > 0 ? 'file' : 'content' };
    }
    const source: Source | { missing: 'reply' | 'answer' } = content
      ? { markdown: content, title, prompt: '', provider: getProviderLabel(state.providerUrl), from: 'content' }
      : await exportSourceFor(state);
    if ('missing' in source) return source;
    // An answer drawn as a card: PDF, PNG or WebP ("jpg" asks for a picture, and the card is a PNG).
    const file = await exportAnswerFile({ ...source, title: title || source.title }, format === 'webp' || format === 'pdf' ? format : 'png');
    await keepDocument(state, file.path);
    return { name: path.basename(file.path), format: file.format, from: source.from };
  };
}

/** The files to send with the answer; read from a run file, so only names in the chat media folder count. */
export function runDocuments(state: AgentRunState, dir?: string): string[] {
  return inChatMedia(state.documents, dir);
}

/** The copy a run's connector-written file gets in the chat media folder: one per source per run. */
export function keptDocumentName(runId: string, file: string): string {
  const tag = runId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'run';
  return `${tag}-${path.basename(file)}`;
}

/**
 * Keeps the files a built-in connector wrote for one run (an edited spreadsheet). A bot may only
 * send what lies in the chat media folder, so each is copied there under one name per run — a later
 * edit of the same file replaces that copy — and goes out with the answer like `export_file`'s.
 */
export function agentDocumentKeeper(state: AgentRunState): (files: readonly string[]) => Promise<void> {
  return async (files) => {
    const dir = chatMediaDir();
    const kept: string[] = [];
    for (const file of files) {
      try {
        await fs.mkdir(dir, { recursive: true });
        const copy = path.join(dir, keptDocumentName(state.runId, file));
        await writeFileAtomic(copy, await fs.readFile(file));
        kept.push(copy);
      } catch (err) {
        sendLog(`⚠️ [Agent] Edited file not kept: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const fresh = kept.filter((file) => !(state.documents ?? []).includes(file));
    if (kept.length === 0) return;
    if (fresh.length > 0) state.documents = [...(state.documents ?? []), ...fresh];
    state.updatedAt = new Date().toISOString();
    await saveRunState(state);
  };
}
