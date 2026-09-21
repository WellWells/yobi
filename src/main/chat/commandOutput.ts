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
}

function turnMetaFor(args: CommandResult): TurnMeta {
  const attached = attachmentMetaNames(args.attachments ?? []);
  // The meta rides in an HTML comment, so a choice must not be able to close it.
  const choices = (args.choices ?? []).map((choice) => choice.replace(/-->/g, '--')).filter(Boolean);
  return {
    p: args.providerLabel,
    t: new Date().toISOString(),
    m: 'replay',
    ...(args.command ? { c: args.command } : {}),
    ...(attached.length > 0 ? { a: attached } : {}),
    ...(args.runId ? { r: args.runId } : {}),
    ...(choices.length > 0 ? { ch: choices } : {}),
    ...(args.memoryNotes?.length ? { mem: args.memoryNotes } : {}),
    ...(args.usage ? tokenMetaFields(args.usage) : {}),
  };
}

/**
 * Shows a slash command's answer in temporary chat.
 *
 * The turn is not optional: a temporary conversation is one markdown blob, and delivering
 * content with no turn REPLACES it. `/search` and flow chat commands used to do exactly that,
 * so answering one wiped every temporary turn before it. Going through here means a call site
 * can no longer leave the turn out.
 */
export function deliverCommandResultToTempChat(args: CommandResult): void {
  const meta = turnMetaFor(args);
  deliverTempChatResult({
    // The same meta on both paths: `content` is what an empty temporary conversation starts
    // from, `turn` is what every later answer appends, and a turn should not describe itself
    // differently depending on which of the two it happened to arrive through.
    content: buildOutputMarkdown({
      ...args.markdownOptions,
      turnMeta: { ...args.markdownOptions.turnMeta, ...meta },
    }),
    turn: { prompt: args.prompt, response: args.response, meta },
  });
}

export async function saveCommandOutput(args: CommandResult): Promise<string> {
  const { conversationPath, markdownOptions, prompt, response, usage } = args;
  const tokens = usage ? tokenMetaFields(usage) : {};

  if (conversationPath) {
    try {
      await fs.access(conversationPath);
      // Same builder as the temporary-chat path: the two used to spell the same meta out
      // separately, and a field added to one (the run id was the first) went missing from the
      // other with nothing to catch it.
      await appendConversationTurn(conversationPath, { prompt, response, meta: turnMetaFor(args) });
      return conversationPath;
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      sendLog(`⚠️ Could not append the command result to its conversation (${detail}) — saving as a new file`);
    }
  }

  const outputDir = await getOutputDir();
  return saveOutput({
    ...markdownOptions,
    turnMeta: { ...markdownOptions.turnMeta, ...tokens },
    outputDir,
  });
}
