import type { AgentFlowStepRef, FlowDefinition } from './types';
import { isVersionId } from './conversationHistory';

/**
 * Versions of a flow: every save that changes what the flow does, tagged with who made it. Pure:
 * what counts as a change, and what is read back from the version file.
 */

/** `initial` is the flow as it was before its first versioned change, kept as the starting point. */
export type FlowVersionSource = 'initial' | 'user' | 'ai-edit' | 'ai-build' | 'import' | 'restore';
export const FLOW_VERSION_SOURCES: readonly FlowVersionSource[] = ['initial', 'user', 'ai-edit', 'ai-build', 'import', 'restore'];
/** What a renderer save may say about itself; the other sources are main's own. */
export type FlowSaveSource = 'user' | 'import';

/** Versions kept per flow; the oldest goes first. */
export const FLOW_VERSION_CAP = 50;
/** A flow id that may name a version file: what `createEntityId` and the renderer's ids look like. */
export const FLOW_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export interface FlowSaveOrigin {
  source: Exclude<FlowVersionSource, 'initial'>;
  restoredFrom?: string;
}

/** What one save changed: the steps by id, then the flow-level fields `edit_flow` does not report. */
export interface FlowChangeSummary {
  added: AgentFlowStepRef[];
  removed: AgentFlowStepRef[];
  changed: AgentFlowStepRef[];
  renamedFrom?: string;
  trigger: boolean;
  description?: boolean;
  variables?: boolean;
  order?: boolean;
}

export interface FlowVersionRecord {
  vid: string;
  at: string;
  source: FlowVersionSource;
  /** Null for the first version of a new flow: there was nothing before it. */
  summary: FlowChangeSummary | null;
  restoredFrom?: string;
  flow: FlowDefinition;
}

/** A version as the history dialog lists it. */
export interface FlowVersionView {
  vid: string;
  at: string;
  source: FlowVersionSource;
  summary: FlowChangeSummary | null;
  restoredFrom?: string;
  name: string;
  /** What restoring this version would change in the flow as it is now. */
  toCurrent: FlowChangeSummary;
  /** It reads the same as the flow now. */
  current: boolean;
}

export type FlowVersionList = { ok: true; versions: FlowVersionView[] } | { ok: false };

export type FlowVersionRestoreResult =
  | { ok: true; flow: FlowDefinition; paused: boolean }
  | { ok: false; reason: 'missing' | 'failed' };

export function isHistoryFlowId(value: unknown): value is string {
  return typeof value === 'string' && FLOW_ID_RE.test(value);
}

export function parseFlowSaveSource(value: unknown): FlowSaveSource {
  return value === 'import' ? 'import' : 'user';
}

/** JSON with object keys sorted, so two saves of one flow compare equal however their keys were ordered. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

/**
 * The flow as a version compares it: the save time and the switch are not content. Saving before a
 * run, switching a flow on, or the editor's silent saves would otherwise each leave a version.
 */
export function flowContentKey(flow: FlowDefinition): string {
  const { updatedAt: _updated, createdAt: _created, enabled: _enabled, ...content } = flow;
  return stableStringify(content);
}

export function sameFlowContent(a: FlowDefinition, b: FlowDefinition): boolean {
  return flowContentKey(a) === flowContentKey(b);
}

export function isEmptyFlowChange(summary: FlowChangeSummary): boolean {
  return summary.added.length === 0 && summary.removed.length === 0 && summary.changed.length === 0
    && !summary.renamedFrom && !summary.trigger && !summary.description && !summary.variables && !summary.order;
}

/**
 * What "What this save changed" says when it lists nothing: the flow as it was before its first
 * recorded change was not created then, a first save was, and a later save changed nothing listed.
 */
export function flowVersionNoneKey(version: Pick<FlowVersionView, 'source' | 'summary'>): string {
  if (version.source === 'initial') return 'flow.versions.initialState';
  return version.summary ? 'flow.versions.noChange' : 'flow.versions.created';
}

function isFlow(value: unknown): value is FlowDefinition {
  if (!value || typeof value !== 'object') return false;
  const flow = value as Record<string, unknown>;
  return typeof flow.id === 'string' && typeof flow.name === 'string' && Array.isArray(flow.steps)
    && Boolean(flow.trigger) && typeof flow.trigger === 'object';
}

function isRecord(value: unknown): value is FlowVersionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return isVersionId(record.vid)
    && typeof record.at === 'string'
    && FLOW_VERSION_SOURCES.includes(record.source as FlowVersionSource)
    && (record.summary === null || (typeof record.summary === 'object' && record.summary !== null))
    && isFlow(record.flow);
}

/** The version file's records, oldest first; anything malformed is dropped rather than trusted. */
export function parseFlowVersionRecords(value: unknown): FlowVersionRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter(isRecord).filter((record) => !seen.has(record.vid) && Boolean(seen.add(record.vid)));
}

/** Step ids any kept version still uses: their read state must survive a step's removal. */
export function versionStepIds(records: readonly FlowVersionRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    for (const step of record.flow.steps) {
      if (typeof step?.id === 'string') ids.add(step.id);
    }
  }
  return ids;
}
