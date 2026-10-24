import { buildOutputMarkdown, saveOutput } from '../output';
import { resolveConversationPath } from '../conversationIndex';
import type { MarkdownOptions } from '../output';
import { getOutputDir } from '../files';
import { sendLog } from '../helpers';
import { deliverTempChatResult } from '../tempChat';
import { tokenMetaFields } from '../../shared/tokenEstimate';
import type { TokenUsage } from '../../shared/tokenEstimate';
import { attachmentMetaNames } from '../../shared/conversationDoc';
import type { TurnButton, TurnMeta } from '../../shared/conversationDoc';
import type { MemoryNote } from '../../shared/userMemory';
import type { TurnPostCard } from '../../shared/postCard';
import { appendConversationTurn } from './conversationStore';

export interface CommandResult {
  conversationPath?: string | undefined;
  markdownOptions: MarkdownOptions;
  prompt: string;
  response: string;
  providerLabel: string;
  command?: string;
  attachments?: string[];
  usage?: TokenUsage;
  /** Agent run id, so the saved turn can reopen the reasoning that produced it. */
  runId?: string;
  /** Choices an agent question offers. */
  choices?: string[];
  /** What the answer changed in the user's memory. */
  memoryNotes?: MemoryNote[];
  /** The Agent's recap line; `''` marks a run made where no recap is kept. Absent for other commands. */
  recap?: string;
  /** Name prefix when the result starts a new file (a bot chat's conversation). */
  fileLabel?: string;
  /** `Date.now()` when the command started running, for the turn's duration. */
  startedAt?: number;
  /** A flow's buttons, each already the full command line it sends. */
  buttons?: TurnButton[];
  /** Files the command saved on this computer, offered as "show in folder". */
  files?: string[];
  /** Photos and videos shown under the answer from the chat's media cache (not "saved"). */
  chatMedia?: string[];
  /** The X post a bare pasted link forwarded, offered as "analyze the post and its replies". */
  xPost?: string;
  /** A forwarded forum article's header, drawn as a card in place of the answer's opening block. */
  postCard?: TurnPostCard;
}

export function turnMetaFor(args: CommandResult): TurnMeta {
  const attached = attachmentMetaNames(args.attachments ?? []);
  // The meta rides in an HTML comment, so a choice must not be able to close it.
  const choices = (args.choices ?? []).map((choice) => choice.replace(/-->/g, '--')).filter(Boolean);
  const buttons = (args.buttons ?? [])
    .map((b) => ({ l: b.l.replace(/-->/g, '--'), i: b.i.replace(/-->/g, '--'), ...(b.p ? { p: b.p.replace(/-->/g, '--') } : {}) }))
    .filter((b) => b.l && b.i);
  return {
    p: args.providerLabel,
    t: new Date().toISOString(),
    ...(args.startedAt !== undefined ? { d: Math.max(0, Date.now() - args.startedAt) } : {}),
    ...(args.command ? { c: args.command } : {}),
    ...(attached.length > 0 ? { a: attached } : {}),
    ...(args.runId ? { r: args.runId } : {}),
    ...(choices.length > 0 ? { ch: choices } : {}),
    ...(args.memoryNotes?.length ? { mem: args.memoryNotes } : {}),
    ...(args.usage ? tokenMetaFields(args.usage) : {}),
    ...(args.recap !== undefined ? { rc: args.recap } : {}),
    ...(buttons.length > 0 ? { bt: buttons } : {}),
    ...(args.files?.length ? { fl: args.files.map((f) => f.replace(/-->/g, '--')) } : {}),
    ...(args.chatMedia?.length ? { mv: args.chatMedia.map((f) => f.replace(/-->/g, '--')) } : {}),
    ...(args.xPost ? { xp: args.xPost } : {}),
    ...(args.postCard ? { pc: args.postCard } : {}),
  };
}

/**
 * Shows a slash command's answer in temporary chat. The turn is always passed: content delivered
 * without a turn replaces the whole temporary conversation.
 */
export function deliverCommandResultToTempChat(args: CommandResult): void {
  const meta = turnMetaFor(args);
  deliverTempChatResult({
    // Same meta on both paths: `content` seeds an empty temporary conversation, `turn` appends to one.
    content: buildOutputMarkdown({
      ...args.markdownOptions,
      turnMeta: { ...args.markdownOptions.turnMeta, ...meta },
    }),
    turn: { prompt: args.prompt, response: args.response, meta },
  });
}

export async function saveCommandOutput(args: CommandResult): Promise<string> {
  const { conversationPath, markdownOptions, prompt, response } = args;

  if (conversationPath) {
    try {
      // Moved into a folder while the command ran: found again by its id, not started over.
      const target = await resolveConversationPath({ path: conversationPath });
      if (!target) throw new Error(`${conversationPath} no longer exists`);
      // Same meta builder as the temporary-chat path, so both write identical fields.
      await appendConversationTurn(target, { prompt, response, meta: turnMetaFor(args) });
      return target;
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      sendLog(`⚠️ Could not append the command result to its conversation (${detail}) — saving as a new file`);
    }
  }

  // A new file's first turn gets the same meta as later turns, minus the mode: it replays nothing.
  const { m: _mode, ...meta } = turnMetaFor(args);
  const outputDir = await getOutputDir();
  return saveOutput({
    ...markdownOptions,
    turnMeta: { ...markdownOptions.turnMeta, ...meta },
    outputDir,
    ...(args.fileLabel ? { fileLabel: args.fileLabel } : {}),
  });
}
