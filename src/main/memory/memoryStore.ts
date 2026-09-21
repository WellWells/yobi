import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getFlowDataDir } from '../flow/paths';
import { Mutex } from '../flow/lanes';
import { sendLog } from '../helpers';
import { emptyMemoryState, normalizeMemoryState } from './memoryState';
import type { UserMemoryState } from './memoryState';

/**
 * A folder with one file rather than a bare file: backups restore folders as a whole, so this rides
 * the existing restore path instead of needing its own. Kept out of config.json for the same reason
 * as the bot directory — restoring an older backup rewrites config.json, and exporting settings to
 * show someone a problem must not carry the user's personal facts along.
 */
export const USER_MEMORY_DIR = 'user-memory';
const USER_MEMORY_FILE = 'memory.json';

export function userMemoryDir(): string {
  return path.join(getFlowDataDir(), USER_MEMORY_DIR);
}

function userMemoryPath(): string {
  return path.join(userMemoryDir(), USER_MEMORY_FILE);
}

type Listener = (state: UserMemoryState) => void;
const listeners = new Set<Listener>();

export function onUserMemoryChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface Loaded {
  state: UserMemoryState;
  /** The file exists but could not be read as memory; it must be moved aside before anything is written. */
  corrupt: boolean;
}

async function readState(): Promise<Loaded> {
  let raw: string;
  try {
    raw = await fs.readFile(userMemoryPath(), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      sendLog(`⚠️ [Memory] could not read the memory file: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { state: emptyMemoryState(), corrupt: false };
  }
  try {
    return { state: normalizeMemoryState(JSON.parse(raw)), corrupt: false };
  } catch {
    return { state: emptyMemoryState(), corrupt: true };
  }
}

/**
 * Read fresh every time, never cached: the file is small, and a restored backup or a second writer
 * then takes effect on the very next send instead of being overwritten by a stale copy.
 */
export async function loadUserMemory(): Promise<UserMemoryState> {
  return (await readState()).state;
}

const writes = new Mutex();

async function writeState(state: UserMemoryState): Promise<void> {
  const file = userMemoryPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}-${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

/**
 * The one way to change the memory: a read-modify-write under a lock, because a chat reply, an
 * agent run and a bot message can all finish at the same moment. `mutate` returns null to leave
 * the file untouched.
 */
export async function updateUserMemory<T>(
  mutate: (state: UserMemoryState) => { state: UserMemoryState; result: T } | null,
): Promise<{ state: UserMemoryState; result: T | null }> {
  return writes.runExclusive(async () => {
    const loaded = await readState();
    const change = mutate(loaded.state);
    if (!change) return { state: loaded.state, result: null };
    if (loaded.corrupt) {
      // Never write over a file that could not be parsed: it is the only copy of what it held.
      const aside = path.join(userMemoryDir(), `memory.corrupt-${Date.now()}.json`);
      await fs.rename(userMemoryPath(), aside).catch(() => {});
      sendLog(`⚠️ [Memory] memory file was unreadable — kept it as ${path.basename(aside)}`);
    }
    await writeState(change.state);
    for (const listener of listeners) listener(change.state);
    return { state: change.state, result: change.result };
  });
}

export async function deleteUserMemoryFiles(): Promise<void> {
  await fs.rm(userMemoryDir(), { recursive: true, force: true }).catch(() => {});
}
