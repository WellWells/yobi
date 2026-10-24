import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let testFlowDataDir: string | null = null;

/**
 * In dev the flow data dir is the repo root, so tests get a temp dir instead and never overwrite
 * real flow data (bot-conversations.json is the only record of past pairings).
 */
function getTestFlowDataDir(): string {
  testFlowDataDir ??= mkdtempSync(path.join(os.tmpdir(), 'yobi-test-flow-'));
  return testFlowDataDir;
}

export function getFlowDataDir(): string {
  if (app.isPackaged) return app.getPath('userData');
  if (process.env.VITEST) return getTestFlowDataDir();
  return path.resolve('.');
}

export const CHECKPOINT_KINDS = [
  'rss',
  'scraper',
  'youtube_subs',
  'youtube_channels',
  'x_posts',
  'ptt_board',
  'on_change',
  'line_read',
  'mail_fetch',
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export function getCheckpointPath(kind: CheckpointKind, stepId: string): string {
  return path.join(getFlowDataDir(), 'flow-checkpoints', `${kind}-${stepId}.json`);
}
