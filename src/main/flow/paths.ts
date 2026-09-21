import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let testFlowDataDir: string | null = null;

/**
 * Same trap configPaths already guards: in dev this directory IS the repo root and Vitest runs from
 * there with an isPackaged: false stand-in, so a test that persisted a checkpoint or a conversation
 * pointer overwrote the developer's own flow data. bot-conversations.json matters most — it is the
 * only surviving record of which accounts once held a pairing.
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
  'on_change',
  'line_read',
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export function getCheckpointPath(kind: CheckpointKind, stepId: string): string {
  return path.join(getFlowDataDir(), 'flow-checkpoints', `${kind}-${stepId}.json`);
}
