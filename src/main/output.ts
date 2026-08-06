import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import dayjs from 'dayjs';
import { getUniquePath } from './files';
import { cleanTitle } from '../shared/conversationTitle';
import type { TurnMeta } from '../shared/conversationDoc';

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
}

interface SaveOptions extends MarkdownOptions {
  outputDir: string;
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
}: MarkdownOptions): string {
  const timestamp = dayjs().format('YYYY-MM-DDTHH:mm:ssZ');
  return [
    `# ${title}`,
    '',
    ...(provider ? [`## ${providerLabel}`, '', provider, ''] : []),
    `## ${timestampLabel}`,
    '',
    timestamp,
    '',
    ...(turnMeta ? [`<!-- yobi:turn ${JSON.stringify(turnMeta)} -->`] : []),
    `## ${promptLabel}`,
    '',
    prompt,
    '',
    `## ${responseLabel}`,
    '',
    response,
    '',
  ].join('\n');
}

async function freeOutputPath(outputDir: string): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const desired = path.join(outputDir, `${dayjs().format('YYYY-MM-DD-HH-mm-ss')}.md`);
  return getUniquePath(desired, '');
}

export async function saveOutput({ outputDir, ...markdownOptions }: SaveOptions): Promise<string> {
  const filePath = await freeOutputPath(outputDir);
  await fs.writeFile(filePath, buildOutputMarkdown(markdownOptions), 'utf-8');
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
  const content = `# ${titleFromPrompt(args.prompt) || 'Untitled'}\n`;
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
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    if (lines.some((line) => line.trim() === `## ${args.providerLabel}`)) return;
    lines.splice(headerInsertIndex(lines), 0,
      `## ${args.providerLabel}`, '', args.provider, '',
      `## ${args.timestampLabel}`, '', dayjs().format('YYYY-MM-DDTHH:mm:ssZ'), '');
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
  } catch {
  }
}

export async function discardEmptyConversation(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
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
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    if (lines[0]?.trim() !== `# ${expected}`) return;
    lines[0] = `# ${title}`;
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
  } catch {
  }
}
