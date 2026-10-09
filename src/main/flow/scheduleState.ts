import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomicSync } from '../atomicWrite';
import { getFlowDataDir } from './paths';

export interface TriggerRunState {
  /** When this trigger is next due. A value in the past means the machine was off for it. */
  nextRunAt?: string;
  lastRunAt?: string;
  /** Set once a one-shot schedule has fired, so a restart never re-arms it for next year. */
  onceFiredAt?: string;
}

type ScheduleState = Record<string, TriggerRunState>;

const WRITE_DEBOUNCE_MS = 1_000;

let state: ScheduleState = {};
let writeTimer: NodeJS.Timeout | null = null;

/** Kept out of flows.json: a cron tick must not rewrite the user's flow definitions. */
function getStatePath(): string {
  return path.join(getFlowDataDir(), 'flow-schedule-state.json');
}

export function triggerStateKey(flowId: string, triggerIndex: number): string {
  return `${flowId}#${triggerIndex}`;
}

export async function loadScheduleState(): Promise<void> {
  try {
    const raw = await fs.readFile(getStatePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    state = typeof parsed === 'object' && parsed !== null ? (parsed as ScheduleState) : {};
  } catch {
    state = {};
  }
}

export function getTriggerState(key: string): TriggerRunState | undefined {
  return state[key];
}

/**
 * The one writer, and synchronous so the flush on quit has finished before the app exits. Silent
 * on failure: a schedule that could not be saved still runs from memory this session.
 */
function persistNow(): void {
  try {
    const target = getStatePath();
    fsSync.mkdirSync(path.dirname(target), { recursive: true });
    writeFileAtomicSync(target, JSON.stringify(state, null, 2));
  } catch {
  }
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    persistNow();
  }, WRITE_DEBOUNCE_MS);
  writeTimer.unref?.();
}

/**
 * Writes a pending patch now, for the quit path: the debounce timer is unref'd, so a fire recorded just
 * before quitting would otherwise be lost and caught up again. No-op when nothing is pending, so an
 * early quit cannot empty the file.
 */
export function flushScheduleState(): void {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  persistNow();
}

export function patchTriggerState(key: string, patch: TriggerRunState): void {
  state[key] = { ...state[key], ...patch };
  scheduleWrite();
}

/** Drops entries for flows that no longer exist, so the file cannot grow without bound. */
export function pruneScheduleState(liveFlowIds: Iterable<string>): void {
  const live = new Set(liveFlowIds);
  let changed = false;
  for (const key of Object.keys(state)) {
    const flowId = key.slice(0, key.lastIndexOf('#'));
    if (!live.has(flowId)) {
      delete state[key];
      changed = true;
    }
  }
  if (changed) scheduleWrite();
}

export function resetScheduleStateForTests(next: ScheduleState = {}): void {
  state = next;
}
