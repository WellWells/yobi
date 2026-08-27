import * as fs from 'node:fs/promises';
import { saveOutput } from '../output';
import type { MarkdownOptions } from '../output';
import { getOutputDir } from '../files';
import { sendLog } from '../helpers';
import { tokenMetaFields } from '../../shared/tokenEstimate';
import type { TokenUsage } from '../../shared/tokenEstimate';
import { attachmentMetaNames } from '../../shared/conversationDoc';
import { appendConversationTurn } from './conversationStore';

export async function saveCommandOutput(args: {
  conversationPath: string | undefined;
  markdownOptions: MarkdownOptions;
  prompt: string;
  response: string;
  providerLabel: string;
  command?: string;
  attachments?: string[];
  usage?: TokenUsage;
}): Promise<string> {
  const { conversationPath, markdownOptions, prompt, response, providerLabel, command, usage } = args;
  const attached = attachmentMetaNames(args.attachments ?? []);
  const tokens = usage ? tokenMetaFields(usage) : {};

  if (conversationPath) {
    try {
      await fs.access(conversationPath);
      await appendConversationTurn(conversationPath, {
        prompt,
        response,
        meta: {
          p: providerLabel,
          t: new Date().toISOString(),
          m: 'replay',
          ...(command ? { c: command } : {}),
          ...(attached.length > 0 ? { a: attached } : {}),
          ...tokens,
        },
      });
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
