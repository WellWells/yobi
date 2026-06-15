import { app } from 'electron';
import * as path from 'node:path';

export function getFlowDataDir(): string {
  return app.isPackaged ? app.getPath('userData') : path.resolve('.');
}

export function getCheckpointPath(kind: 'rss' | 'scraper' | 'youtube_subs', stepId: string): string {
  return path.join(getFlowDataDir(), 'flow-checkpoints', `${kind}-${stepId}.json`);
}
