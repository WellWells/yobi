import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FlowDefinition } from '../../shared/types';
import { makeVersionId } from '../../shared/conversationHistory';
import {
  FLOW_VERSION_CAP,
  flowContentKey,
  isHistoryFlowId,
  parseFlowVersionRecords,
  sameFlowContent,
  stableStringify,
  versionStepIds,
} from '../../shared/flowVersions';
import type {
  FlowChangeSummary,
  FlowSaveOrigin,
  FlowVersionRecord,
  FlowVersionView,
} from '../../shared/flowVersions';
import { writeFileAtomic } from '../atomicWrite';
import { flowHistoryRoot } from '../history/historyPaths';
import { Mutex } from './lanes';
import { diffFlows, restoredTriggers, SENSITIVE_STEP_TYPES } from './flowRevision';

/*
 * Every save that changes what a flow does is kept in `history/flows/<flowId>.json`, newest last,
 * at most FLOW_VERSION_CAP. One lock for all of them: each write reads, changes and writes a file.
 */

const writes = new Mutex();

function fileFor(flowId: string): string {
  if (!isHistoryFlowId(flowId)) throw new Error('Invalid flow id');
  return path.join(flowHistoryRoot(), `${flowId}.json`);
}

/**
 * A flow's versions, oldest first. Only a missing file is an empty history: one that cannot be read
 * or makes no sense throws, so a save never writes a fresh history over versions it could not see.
 */
async function readRecords(flowId: string): Promise<FlowVersionRecord[]> {
  if (!isHistoryFlowId(flowId)) return [];
  let raw: string;
  try {
    raw = await fs.readFile(fileFor(flowId), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return [];
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  const records = parseFlowVersionRecords(parsed);
  if (!Array.isArray(parsed) || (parsed.length > 0 && records.length === 0)) throw new Error('Unreadable flow history');
  return records;
}

/** For reading only: a history that cannot be read lists as empty, so the dialog still opens. */
async function readRecordsOrEmpty(flowId: string): Promise<FlowVersionRecord[]> {
  try {
    return await readRecords(flowId);
  } catch (err: unknown) {
    console.warn(`[history] could not read a flow's versions: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function writeRecords(flowId: string, records: FlowVersionRecord[]): Promise<void> {
  if (records.length === 0) {
    await fs.rm(fileFor(flowId), { force: true });
  } else {
    await fs.mkdir(flowHistoryRoot(), { recursive: true });
    await writeFileAtomic(fileFor(flowId), JSON.stringify(records, null, 2));
  }
  stepIdCache?.set(flowId, versionStepIds(records));
}

/** What `after` changed against `before`: the steps as `edit_flow` reports them, plus the rest. */
export function summarizeFlowChange(before: FlowDefinition, after: FlowDefinition): FlowChangeSummary {
  const diff = diffFlows(before, after);
  const beforeIds = before.steps.map((step) => step.id);
  const afterIds = after.steps.map((step) => step.id);
  const kept = afterIds.filter((id) => beforeIds.includes(id));
  const order = kept.join('\n') !== beforeIds.filter((id) => afterIds.includes(id)).join('\n');
  return {
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    ...(diff.renamedFrom !== undefined ? { renamedFrom: diff.renamedFrom } : {}),
    trigger: diff.trigger,
    ...((before.description ?? '') !== (after.description ?? '') ? { description: true } : {}),
    ...(stableStringify(before.variables ?? []) !== stableStringify(after.variables ?? []) ? { variables: true } : {}),
    ...(order ? { order: true } : {}),
  };
}

/**
 * Keeps the flow as just saved, unless it reads the same as the newest version. The first time a
 * flow that predates its history changes, the flow as it was is kept first, so the change can be
 * undone. Never throws: a version that could not be kept must not fail the save.
 */
export function recordFlowSave(
  previous: FlowDefinition | undefined,
  saved: FlowDefinition,
  origin: FlowSaveOrigin,
  now: () => number = Date.now,
): Promise<void> {
  if (!isHistoryFlowId(saved.id)) return Promise.resolve();
  return writes.runExclusive(async () => {
    try {
      const records = await readRecords(saved.id);
      const latest = records.at(-1)?.flow;
      if (latest && sameFlowContent(latest, saved)) return;
      if (!latest && previous && sameFlowContent(previous, saved)) return;
      const stamp = (): string => {
        let vid = makeVersionId(now());
        while (records.some((record) => record.vid === vid)) vid = makeVersionId(now());
        return vid;
      };
      if (!latest && previous) {
        records.push({ vid: stamp(), at: new Date(now()).toISOString(), source: 'initial', summary: null, flow: previous });
      }
      const before = latest ?? previous;
      records.push({
        vid: stamp(),
        at: new Date(now()).toISOString(),
        source: origin.source,
        summary: before ? summarizeFlowChange(before, saved) : null,
        ...(origin.restoredFrom ? { restoredFrom: origin.restoredFrom } : {}),
        flow: saved,
      });
      await writeRecords(saved.id, records.slice(-FLOW_VERSION_CAP));
    } catch (err: unknown) {
      console.warn(`[history] could not keep a flow version: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/** Oldest first. */
export function listFlowVersionRecords(flowId: string): Promise<FlowVersionRecord[]> {
  return writes.runExclusive(() => readRecordsOrEmpty(flowId));
}

export async function getFlowVersion(flowId: string, vid: string): Promise<FlowVersionRecord | null> {
  return (await listFlowVersionRecords(flowId)).find((record) => record.vid === vid) ?? null;
}

export function deleteFlowVersion(flowId: string, vid: string): Promise<boolean> {
  if (!isHistoryFlowId(flowId)) return Promise.resolve(false);
  return writes.runExclusive(async () => {
    const records = await readRecords(flowId);
    const next = records.filter((record) => record.vid !== vid);
    if (next.length === records.length) return false;
    await writeRecords(flowId, next);
    return true;
  });
}

/** Every version of these flows, gone: deleting a flow deletes its history. */
export function deleteFlowVersions(flowIds: readonly string[]): Promise<void> {
  return writes.runExclusive(async () => {
    for (const flowId of flowIds.filter(isHistoryFlowId)) {
      await fs.rm(fileFor(flowId), { force: true }).catch(() => undefined);
      stepIdCache?.delete(flowId);
    }
  });
}

/** The versions newest first, each against the flow as it is now. */
export function viewFlowVersions(records: readonly FlowVersionRecord[], current: FlowDefinition): FlowVersionView[] {
  const currentKey = flowContentKey(current);
  return [...records].reverse().map((record) => ({
    vid: record.vid,
    at: record.at,
    source: record.source,
    summary: record.summary,
    ...(record.restoredFrom ? { restoredFrom: record.restoredFrom } : {}),
    name: record.flow.name,
    toCurrent: summarizeFlowChange(current, restoredFlowFrom(current, record.flow).flow),
    current: flowContentKey(record.flow) === currentKey,
  }));
}

/**
 * A version as it goes back in: its steps (with their ids, so read state carries over), triggers,
 * variables, name and description; the flow's own id and creation time, and whether it is on, stay
 * as they are now. Bot command access is never widened, and an enabled flow that gets back a step
 * acting on the computer is saved off, as `edit_flow` does.
 */
export function restoredFlowFrom(current: FlowDefinition, version: FlowDefinition): { flow: FlowDefinition; paused: boolean } {
  const [trigger, ...extraTriggers] = restoredTriggers(
    [version.trigger, ...(version.extraTriggers ?? [])],
    [current.trigger, ...(current.extraTriggers ?? [])],
  );
  const { extraTriggers: _extras, ...rest } = version;
  const restored: FlowDefinition = {
    ...rest,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    enabled: current.enabled,
    trigger: trigger!,
    ...(extraTriggers.length ? { extraTriggers } : {}),
  };
  const diff = diffFlows(current, restored);
  const paused = restored.enabled && [...diff.added, ...diff.changed].some((ref) => SENSITIVE_STEP_TYPES.has(ref.type));
  return { flow: paused ? { ...restored, enabled: false } : restored, paused };
}

let stepIdCache: Map<string, Set<string>> | null = null;
let stepIdLoad: Promise<void> | null = null;

async function loadStepIds(): Promise<Map<string, Set<string>>> {
  const cache = new Map<string, Set<string>>();
  let names: string[] = [];
  try {
    names = await fs.readdir(flowHistoryRoot());
  } catch {
    return cache;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const flowId = name.slice(0, -'.json'.length);
    if (isHistoryFlowId(flowId)) cache.set(flowId, versionStepIds(await readRecordsOrEmpty(flowId)));
  }
  return cache;
}

/**
 * Step ids still used by a kept version. Pruning keeps their checkpoints and counters: restoring a
 * version whose feed step was removed must not push every old article again.
 */
export async function versionedStepIds(): Promise<Set<string>> {
  if (!stepIdCache) {
    // Loaded inside the lock, so a version written meanwhile is either read here or added after.
    stepIdLoad ??= writes.runExclusive(async () => {
      stepIdCache ??= await loadStepIds();
    });
    await stepIdLoad;
    stepIdLoad = null;
  }
  return new Set([...(stepIdCache ?? new Map<string, Set<string>>()).values()].flatMap((ids) => [...ids]));
}

/** Versions were replaced on disk (a backup restored): read them again on next use. */
export function resetFlowVersionCache(): void {
  stepIdCache = null;
  stepIdLoad = null;
}
