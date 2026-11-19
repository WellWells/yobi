import { app } from 'electron';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { MANAGED_TOOL_ROWS } from '../../shared/managedTools';
import type { ManagedToolCopy, ManagedToolId, ManagedToolProgress, ManagedToolState } from '../../shared/managedTools';
import { writeFileAtomic } from '../atomicWrite';
import { Mutex } from '../flow/lanes';
import { executableName } from './paths';
import { toolSpec } from './specs';

/*
 * Each managed program's record: `<userData>/tools/<id>/state.json` beside the downloaded
 * executable, plus what lives only in memory (an install in progress, the copy last found).
 * Factory reset deletes the folder; it is not in the backup set (a download is not user data).
 */

export interface PersistedToolState {
  /** The version of the executable Yobi downloaded into the tool's folder. */
  managedVersion?: string;
  customPath?: string;
  lastCheckedAt?: string;
  installError?: string;
}

interface Live {
  persisted: PersistedToolState;
  loaded: boolean;
  installing: boolean;
  progress?: ManagedToolProgress;
  active?: ManagedToolCopy;
  writeLock: Mutex;
}

let dataDirOverride: string | null = null;
let testDataDir: string | null = null;
const live = new Map<ManagedToolId, Live>();
const listeners = new Set<(state: ManagedToolState) => void>();

export function setManagedToolsDataDir(dir: string | null): void {
  dataDirOverride = dir;
  live.clear();
}

function dataDir(): string {
  if (dataDirOverride) return dataDirOverride;
  if (process.env.VITEST) {
    testDataDir ??= mkdtempSync(path.join(os.tmpdir(), 'yobi-test-tools-'));
    return testDataDir;
  }
  return app.getPath('userData');
}

/**
 * `<userData>/tools/<id>`: the downloaded executable and state.json. One fixed path for every
 * version: Windows Firewall and the shell's "always allow" both remember a program by its path.
 */
export function toolRoot(id: ManagedToolId): string {
  return path.join(dataDir(), 'tools', id);
}

export function managedExecutable(id: ManagedToolId, platform: string = process.platform): string {
  return path.join(toolRoot(id), executableName(toolSpec(id).command, platform));
}

function statePath(id: ManagedToolId): string {
  return path.join(toolRoot(id), 'state.json');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** A hand-edited file keeps whatever still has the right shape. */
export function normalizeToolState(raw: unknown): PersistedToolState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const custom = str(value.customPath);
  return {
    ...(str(value.managedVersion) && /^[0-9A-Za-z._-]{1,64}$/.test(String(value.managedVersion)) ? { managedVersion: String(value.managedVersion) } : {}),
    ...(custom && path.isAbsolute(custom) ? { customPath: custom } : {}),
    ...(str(value.lastCheckedAt) ? { lastCheckedAt: String(value.lastCheckedAt) } : {}),
    ...(str(value.installError) ? { installError: String(value.installError) } : {}),
  };
}

/** Reads state.json on first use (a few hundred bytes; menus need an answer without awaiting). */
function entry(id: ManagedToolId): Live {
  let found = live.get(id);
  if (!found) {
    found = { persisted: {}, loaded: false, installing: false, writeLock: new Mutex() };
    live.set(id, found);
  }
  if (!found.loaded) {
    try {
      found.persisted = normalizeToolState(JSON.parse(readFileSync(statePath(id), 'utf-8')));
    } catch {
      found.persisted = {};
    }
    // A record whose executable is gone (deleted by hand, an antivirus) names no version.
    if (found.persisted.managedVersion && !existsSync(managedExecutable(id))) found.persisted.managedVersion = undefined;
    found.loaded = true;
  }
  return found;
}

/** Forgets every in-memory copy, so the next use reads the disk again (after a factory reset). */
export function reloadManagedTools(): void {
  live.clear();
}

export function snapshot(id: ManagedToolId): ManagedToolState {
  const spec = toolSpec(id);
  const row = MANAGED_TOOL_ROWS.find((r) => r.id === id) ?? { id, name: spec.name, homepage: '' };
  const state = entry(id);
  const asset = spec.asset(process.platform, process.arch);
  return {
    id,
    name: row.name,
    homepage: row.homepage,
    supported: asset !== null,
    installing: state.installing,
    ...(state.progress ? { progress: { ...state.progress } } : {}),
    ...(state.active ? { active: { ...state.active } } : {}),
    ...(state.persisted.managedVersion ? { managedVersion: state.persisted.managedVersion } : {}),
    ...(state.persisted.customPath ? { customPath: state.persisted.customPath } : {}),
    downloadBytes: asset?.approxBytes ?? 0,
    minVersion: spec.minVersion,
    ...(state.persisted.lastCheckedAt ? { lastCheckedAt: state.persisted.lastCheckedAt } : {}),
    ...(state.persisted.installError ? { installError: state.persisted.installError } : {}),
  };
}

function broadcast(id: ManagedToolId): void {
  const state = snapshot(id);
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // One broken listener must not stop the others.
    }
  }
}

export function onManagedToolState(listener: (state: ManagedToolState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A copy of the persisted record, for decisions; change it only through `updateToolState`. */
export function readToolState(id: ManagedToolId): PersistedToolState {
  return { ...entry(id).persisted };
}

/** Writes are serialized; a failed write leaves the in-memory record as it was. */
export async function updateToolState(id: ManagedToolId, mutate: (state: PersistedToolState) => void): Promise<ManagedToolState> {
  const state = entry(id);
  return state.writeLock.runExclusive(async () => {
    const next = { ...state.persisted };
    mutate(next);
    await fs.mkdir(toolRoot(id), { recursive: true });
    await writeFileAtomic(statePath(id), JSON.stringify(normalizeToolState(next), null, 2));
    state.persisted = normalizeToolState(next);
    broadcast(id);
    return snapshot(id);
  });
}

export function setInstalling(id: ManagedToolId, on: boolean): void {
  const state = entry(id);
  state.installing = on;
  if (!on) state.progress = undefined;
  broadcast(id);
}

export function setProgress(id: ManagedToolId, progress: ManagedToolProgress | undefined, notify = true): void {
  entry(id).progress = progress;
  if (notify) broadcast(id);
}

/** Records the copy the last lookup found; broadcasts only when it changed. */
export function setActiveCopy(id: ManagedToolId, copy: ManagedToolCopy | undefined): void {
  const state = entry(id);
  const before = state.active;
  if (before?.path === copy?.path && before?.version === copy?.version && before?.source === copy?.source) return;
  state.active = copy;
  broadcast(id);
}
