import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '../atomicWrite';
import { sendLog } from '../helpers';
import { HostPolicy } from './hostPolicy';

/**
 * The learned site manners on disk. A cache Yobi relearns on its own: not in any backup category,
 * deleted by a factory reset.
 */
const FILE_NAME = 'web-hosts.json';
const SAVE_DELAY_MS = 1_000;

let policy: HostPolicy | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> = Promise.resolve();

export function webHostsPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const content = JSON.stringify(policy?.snapshot() ?? {});
    // Writes queue behind each other: two renames of one file at once fail on Windows.
    writing = writing
      .then(() => writeFileAtomic(webHostsPath(), content))
      .catch((err: unknown) => sendLog(`🔎 [Search] could not save ${FILE_NAME} — ${err instanceof Error ? err.message : String(err)}`));
  }, SAVE_DELAY_MS);
}

export function webHostPolicy(): HostPolicy {
  if (policy) return policy;
  policy = new HostPolicy({ onChange: scheduleSave, log: sendLog });
  try {
    policy.load(JSON.parse(readFileSync(webHostsPath(), 'utf-8')));
  } catch {
    // No file yet, or one that does not parse: every site starts as unknown.
  }
  return policy;
}

/** Factory reset: forgets every site, in memory and on disk, after any pending write. */
export async function clearWebHostPolicy(): Promise<void> {
  clearTimeout(saveTimer);
  policy?.clear();
  await writing;
  await fs.rm(webHostsPath(), { force: true }).catch(() => {});
}
