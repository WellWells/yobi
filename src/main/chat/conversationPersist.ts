import * as path from 'node:path';
import { saveOutput } from '../output';
import type { MarkdownOptions } from '../output';
import type { MapPlaceRef, TurnMeta } from '../../shared/conversationDoc';
import { updateConversationThread } from './conversationStore';
import {
  providerKeyFor,
  recordConversationTurn,
  type ConversationSendPlan,
} from './conversationTurnRunner';

export async function appendOrCreateConversation(args: {
  plan: ConversationSendPlan | null;
  conversationPath?: string;
  markdownOptions: MarkdownOptions;
  outputDir: string;
  prompt: string;
  response: string;
  turnMeta: TurnMeta;
  threadUrl: string | null;
  targetUrl: string;
  onLog: (message: string) => void;
  /** Send time of a message that started a new provider thread. */
  threadAt?: string;
  /** The Maps place this turn carried reviews of. */
  map?: MapPlaceRef;
  /** Name prefix for a new file (a bot chat's conversation). */
  fileLabel?: string;
}): Promise<string> {
  const { plan, conversationPath, threadUrl, targetUrl, onLog, map } = args;

  if (plan && conversationPath) {
    try {
      await recordConversationTurn({
        conversationPath,
        prompt: args.prompt,
        response: args.response,
        meta: args.turnMeta,
        thread: map ? { ...plan.thread, map } : plan.thread,
        threadUrl,
        targetUrl,
        previousTurnCount: plan.previousTurnCount,
        ...(args.threadAt ? { threadAt: args.threadAt } : {}),
      });
      onLog(`💬 Appended to ${path.basename(conversationPath)}`);
      return conversationPath;
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      onLog(`⚠️ Could not append to the conversation (${detail}) — saving as a new file`);
    }
  }

  const filePath = await saveOutput({
    ...args.markdownOptions,
    outputDir: args.outputDir,
    ...(args.fileLabel ? { fileLabel: args.fileLabel } : {}),
  });
  if (threadUrl || map) {
    await updateConversationThread(filePath, {
      v: 1,
      ...(threadUrl
        ? {
          provider: providerKeyFor(targetUrl),
          threadUrl,
          threadTurns: 1,
          ...(args.threadAt ? { threadAt: args.threadAt } : {}),
        }
        : {}),
      ...(map ? { map } : {}),
    });
  }
  onLog(`💾 Saved: ${path.basename(filePath)}`);
  return filePath;
}
