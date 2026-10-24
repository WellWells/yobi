import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import dayjs from 'dayjs';
import { getUniquePath } from './files';
import { cleanTitle } from '../shared/conversationTitle';
import type { TurnMeta } from '../shared/conversationDoc';
import { escapeSectionHeadings, stringifyMarker } from '../shared/conversationDoc';
import { repairSplitTableRows } from '../shared/markdownTableRepair';
import { isThreadMarkerLine } from '../shared/conversationHistory';
import { botConversationFolder } from '../shared/conversationFolders';
import type { SystemFolderName } from '../shared/conversationFolders';
import { writeFileAtomic } from './atomicWrite';
import { withConversationFile } from './chat/conversationStore';
import { newConversationId } from './history/conversationHistory';

export interface MarkdownOptions {
  prompt: string;
  response: string;
  title: string;
  provider?: string;
  promptLabel?: string;
  responseLabel?: string;
  timestampLabel?: string;
  providerLabel?: string;
  turnMeta?: TurnMeta;
  /** Written in the thread marker under the title; `saveOutput` gives every new file one. */
  conversationId?: string;
}

interface SaveOptions extends MarkdownOptions {
  outputDir: string;
  /** Put ahead of the timestamp in the file name (a bot chat's `tg-Name`); already file-safe. */
  fileLabel?: string;
  /**
   * A system folder in `outputDir` to write into (flow results). A bot chat's file needs none: its
   * `fileLabel` already says which (`botConversationFolder`).
   */
  folder?: SystemFolderName;
}

export function buildOutputMarkdown({
  prompt,
  response,
  title,
  provider,
  promptLabel = 'Prompt',
  responseLabel = 'Response',
  timestampLabel = 'Time',
  providerLabel = 'Provider',
  turnMeta,
  conversationId,
}: MarkdownOptions): string {
  const timestamp = dayjs().format('YYYY-MM-DDTHH:mm:ssZ');
  return [
    `# ${title}`,
    '',
    ...(conversationId ? [threadIdMarker(conversationId), ''] : []),
    ...(provider ? [`## ${providerLabel}`, '', provider, ''] : []),
    `## ${timestampLabel}`,
    '',
    timestamp,
    '',
    ...(turnMeta ? [`<!-- yobi:turn ${stringifyMarker(turnMeta)} -->`] : []),
    `## ${promptLabel}`,
    '',
    escapeSectionHeadings(prompt, { prompt: promptLabel, response: responseLabel }),
    '',
    `## ${responseLabel}`,
    '',
    repairSplitTableRows(response),
    '',
  ].join('\n');
}

/** The marker a new file is born with: only its id, so a move can always find it again. */
function threadIdMarker(id: string): string {
  return `<!-- yobi:thread ${stringifyMarker({ id, v: 1 })} -->`;
}

/** The folder, made when missing; the top of outputs when a file (not a folder) holds its name. */
async function folderOrTop(outputDir: string, folder: string): Promise<string> {
  const dir = path.join(outputDir, folder);
  await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
  const isDir = await fs.lstat(dir).then((stat) => stat.isDirectory(), () => false);
  return isDir ? dir : outputDir;
}

async function freeOutputPath(outputDir: string, fileLabel = ''): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = dayjs().format('YYYY-MM-DD-HH-mm-ss');
  const desired = path.join(outputDir, `${fileLabel ? `${fileLabel}-` : ''}${stamp}.md`);
  return getUniquePath(desired, '');
}

/**
 * Writes a new conversation file. A bot chat's goes into `Telegram/` or `LINE/`, a flow result into
 * `Flows/` (made again when the user deleted it); everything else stays at the top of outputs.
 */
export async function saveOutput({ outputDir, fileLabel, folder, ...markdownOptions }: SaveOptions): Promise<string> {
  const systemFolder = folder ?? botConversationFolder(fileLabel);
  const filePath = await freeOutputPath(systemFolder ? await folderOrTop(outputDir, systemFolder) : outputDir, fileLabel);
  const conversationId = markdownOptions.conversationId ?? newConversationId();
  await fs.writeFile(filePath, buildOutputMarkdown({ ...markdownOptions, conversationId }), 'utf-8');
  return filePath;
}

export function titleFromPrompt(prompt: string): string {
  return cleanTitle(prompt);
}

export async function createConversationPlaceholder(args: {
  outputDir: string;
  prompt: string;
}): Promise<{ path: string; content: string }> {
  const filePath = await freeOutputPath(args.outputDir);
  const content = `# ${titleFromPrompt(args.prompt) || 'Untitled'}\n\n${threadIdMarker(newConversationId())}\n`;
  await fs.writeFile(filePath, content, 'utf-8');
  return { path: filePath, content };
}

function headerInsertIndex(lines: string[]): number {
  const firstTurn = lines.findIndex((line) => /^<!--\s*yobi:turn\b/.test(line.trim()) || /^##\s/.test(line));
  return firstTurn >= 0 ? firstTurn : lines.length;
}

export async function ensureConversationHeader(filePath: string, args: {
  provider: string;
  providerLabel: string;
  timestampLabel: string;
}): Promise<void> {
  if (!args.provider.trim()) return;
  try {
    // Queued with every other write to this file, and staged: a move takes the same queue.
    await withConversationFile(filePath, async () => {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      if (lines.some((line) => line.trim() === `## ${args.providerLabel}`)) return;
      lines.splice(headerInsertIndex(lines), 0,
        `## ${args.providerLabel}`, '', args.provider, '',
        `## ${args.timestampLabel}`, '', dayjs().format('YYYY-MM-DDTHH:mm:ssZ'), '');
      await writeFileAtomic(filePath, lines.join('\n'));
    });
  } catch {
  }
}

/** A title and nothing else (its id marker is not content): the placeholder of a first send that failed. */
export async function discardEmptyConversation(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').map((line) => line.trim()).filter((line) => line && !isThreadMarkerLine(line));
    if (lines.length !== 1 || !lines[0].startsWith('# ')) return false;
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function upgradeConversationTitle(
  filePath: string,
  expected: string,
  next: string,
): Promise<void> {
  const title = next.trim();
  if (!title || title === expected) return;
  try {
    await withConversationFile(filePath, async () => {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      if (lines[0]?.trim() !== `# ${expected}`) return;
      lines[0] = `# ${title}`;
      await writeFileAtomic(filePath, lines.join('\n'));
    });
  } catch {
  }
}
