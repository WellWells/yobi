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
    await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  return { load, save };
}
