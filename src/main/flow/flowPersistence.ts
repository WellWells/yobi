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
  const dir = path.dirname(getFlowsPath());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getFlowsPath(), JSON.stringify(flows, null, 2), 'utf-8');
}
