import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';

const MEMORY_TITLE = '# Flow Memory';

const MEMORY_PROTOCOL = [
  'After your answer, ONLY if something durable is worth remembering for next time,',
  'output it on the very last line in exactly this format (otherwise add nothing extra):',
  'new_memory: <one concise sentence>',
].join('\n');

export function renderMemory(entries: string[]): string {
  return `${MEMORY_TITLE}\n${entries.map((e) => `- ${e}`).join('\n')}\n`;
}

export function parseMemoryMarkdown(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export function sanitizeFlowId(flowId: string): string {
  return flowId.replace(/[^A-Za-z0-9_-]/g, '_') || 'default';
}

export function buildMemoryAugmentedPrompt(basePrompt: string, entries: string[]): string {
  const memoryBlock = entries.length > 0 ? entries.map((e) => `- ${e}`).join('\n') : '(no memory yet)';
  return [basePrompt, '', '--- MEMORY ---', memoryBlock, '', MEMORY_PROTOCOL].join('\n');
}

export function parseAndStripNewMemory(response: string): { cleaned: string; newMemory: string | null } {
  const matches = [...response.matchAll(/^[ \t]*new_memory:[ \t]*(.+)$/gim)];
  const newMemory = matches.length > 0 ? matches[matches.length - 1][1].trim() : '';
  const cleaned = response
    .replace(/^[ \t]*new_memory:[ \t]*.*$\n?/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleaned, newMemory: newMemory || null };
}

function memoryFilePath(flowId: string): string {
  return path.join(app.getPath('userData'), 'flow-memory', `${sanitizeFlowId(flowId)}.md`);
}

export async function readMemory(flowId: string): Promise<string[]> {
  try {
    return parseMemoryMarkdown(await fs.readFile(memoryFilePath(flowId), 'utf-8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function appendMemory(flowId: string, entry: string): Promise<void> {
  const trimmed = entry.trim();
  if (!trimmed) return;
  const entries = await readMemory(flowId);
  entries.push(trimmed);
  const file = memoryFilePath(flowId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, renderMemory(entries), 'utf-8');
}
