import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Mutex } from './lanes';
import { writeFileAtomic } from '../atomicWrite';
import { app } from 'electron';

const MEMORY_TITLE = '# Flow Memory';

/**
 * Flow memory is a running thread the model writes itself, with no UI, no notice and no forget
 * line. So when it is full the OLDEST entry goes. This is deliberately unlike personal memory
 * (reject when full, plus a curation UI): a thread that silently froze would be worse.
 */
export const FLOW_MEMORY_MAX_ENTRIES = 30;

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

/** An exact duplicate moves to the end instead of repeating; only the newest entries are kept. */
export function withNewEntry(entries: string[], entry: string): string[] {
  return [...entries.filter((e) => e !== entry), entry].slice(-FLOW_MEMORY_MAX_ENTRIES);
}

function renderAugmentedPrompt(basePrompt: string, entries: string[]): string {
  const memoryBlock = entries.length > 0 ? entries.map((e) => `- ${e}`).join('\n') : '(no memory yet)';
  return [basePrompt, '', '--- MEMORY ---', memoryBlock, '', MEMORY_PROTOCOL].join('\n');
}

/**
 * The MEMORY section follows the base prompt (templates say "below") and the protocol stays LAST: a
 * provider cap cuts from the tail, and a model that never sees the protocol stops writing memory.
 * `fits` drops the OLDEST entries until the prompt fits; if none fits, the provider cap applies.
 */
export function buildMemoryAugmentedPrompt(
  basePrompt: string,
  entries: string[],
  fits?: (prompt: string) => boolean,
): string {
  const capped = entries.slice(-FLOW_MEMORY_MAX_ENTRIES);
  if (!fits || capped.length === 0) return renderAugmentedPrompt(basePrompt, capped);
  for (let n = capped.length; n >= 1; n--) {
    const prompt = renderAugmentedPrompt(basePrompt, capped.slice(-n));
    if (fits(prompt)) return prompt;
  }
  return renderAugmentedPrompt(basePrompt, capped);
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

/**
 * Serialized because the body is a read-modify-write across an await.
 *
 * The llm step appends AFTER releasing `llmLane`, so once more than one flow can run at a
 * time two appends to the same flow's memory can interleave and silently drop one of them.
 * Kept private to this module for the same reason as the YouTube lane: the hazard is not
 * visible from the call site.
 */
const memoryWrites = new Mutex();

export async function appendMemory(flowId: string, entry: string): Promise<void> {
  const trimmed = entry.trim();
  if (!trimmed) return;
  await memoryWrites.runExclusive(async () => {
    const entries = withNewEntry(await readMemory(flowId), trimmed);
    const file = memoryFilePath(flowId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, renderMemory(entries));
  });
}

/**
 * Removes the memory of flows that were just deleted, by id only. Never a directory sweep: in dev
 * flows.json comes from the working tree while this memory lives under userData, so another
 * checkout (or a flows.json that failed to load) would read every file as an orphan, and unlike a
 * checkpoint this memory cannot be rebuilt. A file a surviving flow resolves to is kept; the stem
 * comparison ignores case because Windows and macOS file names do.
 */
export async function deleteFlowMemory(
  flowIds: Iterable<string>,
  keepFlowIds: Iterable<string> = [],
): Promise<void> {
  const kept = new Set([...keepFlowIds].map((id) => sanitizeFlowId(id).toLowerCase()));
  await memoryWrites.runExclusive(async () => {
    for (const flowId of flowIds) {
      if (kept.has(sanitizeFlowId(flowId).toLowerCase())) continue;
      try {
        await fs.unlink(memoryFilePath(flowId));
      } catch {
        // Already gone, locked or not permitted: a leftover file is harmless, a thrown delete is not.
      }
    }
  });
}
