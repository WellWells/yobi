import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getCheckpointPath } from './paths';

export interface CheckpointStore<T> {
  load: (stepId: string) => Promise<T | null>;
  save: (stepId: string, checkpoint: T) => Promise<void>;
}

export function makeCheckpointStore<T>(kind: 'rss' | 'scraper' | 'youtube_subs'): CheckpointStore<T> {
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
    // Atomic write (temp + rename): a truncated checkpoint reads back as null and
    // is treated as a first run, causing duplicate re-sends of already-seen items.
    const tmp = `${filePath}.${Date.now()}-${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(checkpoint, null, 2), 'utf-8');
    await fs.rename(tmp, filePath);
  }

  return { load, save };
}
