import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getFlowDataDir } from './paths';
import type { FlowDefinition } from '../../shared/types';

export function createEntityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getFlowsPath(): string {
  return path.join(getFlowDataDir(), 'flows.json');
}

export async function loadFlowsFromDisk(): Promise<FlowDefinition[]> {
  try {
    const raw = await fs.readFile(getFlowsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as FlowDefinition[];
  } catch {
  }
  return [];
}

export async function saveFlowsToDisk(flows: FlowDefinition[]): Promise<void> {
  const target = getFlowsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Write to a unique temp file then atomically rename over the target. A direct
  // writeFile can leave a half-written flows.json if the process dies mid-write
  // (loadFlowsFromDisk then parses [], and the next save persists that empty list,
  // destroying every flow); two concurrent saves could also interleave bytes.
  // rename is atomic and last-writer-wins, so a reader never sees a partial file.
  const tmp = `${target}.${createEntityId()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(flows, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}
