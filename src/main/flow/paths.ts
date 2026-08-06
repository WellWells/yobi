import { app } from 'electron';
import * as path from 'node:path';

export function getFlowDataDir(): string {
  return app.isPackaged ? app.getPath('userData') : path.resolve('.');
}

export const CHECKPOINT_KINDS = ['rss', 'scraper', 'youtube_subs', 'on_change'] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export function getCheckpointPath(kind: CheckpointKind, stepId: string): string {
  return path.join(getFlowDataDir(), 'flow-checkpoints', `${kind}-${stepId}.json`);
}
