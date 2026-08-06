import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CHECKPOINT_KINDS, getCheckpointPath, getFlowDataDir } from './paths';
import type { CheckpointKind } from './paths';

export type { CheckpointKind };

export interface CheckpointStore<T> {
  load: (stepId: string) => Promise<T | null>;
  save: (stepId: string, checkpoint: T) => Promise<void>;
}

export function makeCheckpointStore<T>(kind: CheckpointKind): CheckpointStore<T> {
  async function load(stepId: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(getCheckpointPath(kind, stepId), 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function save(stepId: string, checkpoint: T): Promise<void> {
    const filePath = getCheckpointPath(kind, stepId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${Date.now()}-${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(checkpoint, null, 2), 'utf-8');
    await fs.rename(tmp, filePath);
  }

  return { load, save };
}

export async function pruneOrphanCheckpoints(activeStepIds: Set<string>): Promise<void> {
  const dir = path.join(getFlowDataDir(), 'flow-checkpoints');
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }

  await Promise.all(files.map(async (file) => {
    if (!file.endsWith('.json')) return;
    const base = file.slice(0, -'.json'.length);
    const kind = CHECKPOINT_KINDS.find((k) => base.startsWith(`${k}-`));
    if (!kind) return;
    const stepId = base.slice(kind.length + 1);
    if (activeStepIds.has(stepId)) return;
    try {
      await fs.unlink(path.join(dir, file));
    } catch {
    }
  }));
}
