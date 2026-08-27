import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getFlowDataDir } from './paths';
import { LEGACY_SKILL_TYPES } from '../../shared/flowSkillSchema';
import type { FlowDefinition } from '../../shared/types';

export function createEntityId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getFlowsPath(): string {
  return path.join(getFlowDataDir(), 'flows.json');
}

export function migrateLoadedFlows(flows: FlowDefinition[]): FlowDefinition[] {
  for (const flow of flows) {
    for (const step of flow.steps ?? []) {
      const migrated = LEGACY_SKILL_TYPES[step.type];
      if (migrated) step.type = migrated;
    }
  }
  return flows;
}

export async function loadFlowsFromDisk(): Promise<FlowDefinition[]> {
  try {
    const raw = await fs.readFile(getFlowsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return migrateLoadedFlows(parsed as FlowDefinition[]);
  } catch {
  }
  return [];
}

export async function saveFlowsToDisk(flows: FlowDefinition[]): Promise<void> {
  const target = getFlowsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${createEntityId()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(flows, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}
