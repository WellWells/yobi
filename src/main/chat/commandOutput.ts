import * as fs from 'node:fs/promises';
import { buildOutputMarkdown, saveOutput } from '../output';
import type { MarkdownOptions } from '../output';
import { getOutputDir } from '../files';
import { sendLog } from '../helpers';
import { deliverTempChatResult } from '../tempChat';
import { tokenMetaFields } from '../../shared/tokenEstimate';
import type { TokenUsage } from '../../shared/tokenEstimate';
import { attachmentMetaNames } from '../../shared/conversationDoc';
import type { TurnMeta } from '../../shared/conversationDoc';
import type { MemoryNote } from '../../shared/userMemory';
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
}

function turnMetaFor(args: CommandResult): TurnMeta {
  const attached = attachmentMetaNames(args.attachments ?? []);
  // The meta rides in an HTML comment, so a choice must not be able to close it.
  const choices = (args.choices ?? []).map((choice) => choice.replace(/-->/g, '--')).filter(Boolean);
  return {
    p: args.providerLabel,
    t: new Date().toISOString(),
    ...(args.startedAt !== undefined ? { d: Math.max(0, Date.now() - args.startedAt) } : {}),
    m: 'replay',
    ...(args.command ? { c: args.command } : {}),
    ...(attached.length > 0 ? { a: attached } : {}),
    ...(args.runId ? { r: args.runId } : {}),
    ...(choices.length > 0 ? { ch: choices } : {}),
    ...(args.memoryNotes?.length ? { mem: args.memoryNotes } : {}),
    ...(args.usage ? tokenMetaFields(args.usage) : {}),
    ...(args.recap !== undefined ? { rc: args.recap } : {}),
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
      await fs.access(conversationPath);
      // Same meta builder as the temporary-chat path, so both write identical fields.
      await appendConversationTurn(conversationPath, { prompt, response, meta: turnMetaFor(args) });
      return conversationPath;
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
