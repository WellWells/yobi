import type { FlowDefinition } from './types';

/*
 * The ✨ button on every rename box: one request names one thing with the model the user picked.
 * The window says what is being named; main gathers an outline of it and asks once. Pure.
 */

export type AiNameScope = 'chat' | 'flow';

export type AiNameSource =
  /** A conversation file in the outputs folder: main reads it. */
  | { kind: 'conversation'; path: string }
  /** A markdown document in the outputs folder (a Notion page): main reads it. */
  | { kind: 'document'; path: string }
  /** A category: the titles of what is in it, and the other categories' names to stay clear of. */
  | { kind: 'category'; scope: AiNameScope; items: string[]; taken: string[] }
  /** A flow as the editor holds it, unsaved changes included. */
  | { kind: 'flow'; flow: FlowDefinition }
  /**
   * One flow step: its summary line with the steps around it (the editor's summaries, which never
   * hold code, headers or chat ids), the one to name marked with *.
   */
  | { kind: 'step'; material: string };

export type AiNameKind = AiNameSource['kind'];

export interface AiNameRequest {
  /** Picked by the window; a cancel names it. */
  id: string;
  providerUrl: string;
  source: AiNameSource;
}

export type AiNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'failed'; error: string };

/** A category's name comes from what its members have in common; forty titles show that. */
export const AI_NAME_CATEGORY_MAX_ITEMS = 40;
export const AI_NAME_ITEM_MAX_CHARS = 80;
const TAKEN_MAX = 100;
const STEP_SOURCE_MAX_CHARS = 2_000;

/** Renaming category `name`: its members' titles, the other names taken; null while it is empty. */
export function categoryAiSource(
  scope: AiNameScope, name: string, items: readonly string[], names: readonly string[],
): AiNameSource | null {
  const kept = items.map((item) => item.trim()).filter(Boolean).slice(0, AI_NAME_CATEGORY_MAX_ITEMS);
  if (kept.length === 0) return null;
  return { kind: 'category', scope, items: kept, taken: names.filter((other) => other !== name) };
}

/** Renaming a flow: the flow itself; null while it is blank (no description, no steps). */
export function flowAiSource(flow: FlowDefinition): AiNameSource | null {
  if (!flow.description?.trim() && (flow.steps ?? []).length === 0) return null;
  return { kind: 'flow', flow };
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function stringList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || !value.every(isString)) return null;
  return value.slice(0, max);
}

function parseSource(raw: unknown): AiNameSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  switch (source.kind) {
    case 'conversation':
    case 'document':
      return isString(source.path) && source.path ? { kind: source.kind, path: source.path } : null;
    case 'category': {
      if (source.scope !== 'chat' && source.scope !== 'flow') return null;
      const items = stringList(source.items, AI_NAME_CATEGORY_MAX_ITEMS);
      const taken = stringList(source.taken, TAKEN_MAX);
      return items && taken ? { kind: 'category', scope: source.scope, items, taken } : null;
    }
    case 'flow': {
      const flow = source.flow as Partial<FlowDefinition> | undefined;
      if (!flow || typeof flow !== 'object' || !Array.isArray(flow.steps)) return null;
      return { kind: 'flow', flow: flow as FlowDefinition };
    }
    case 'step':
      return isString(source.material) && source.material.trim() ? { kind: 'step', material: source.material.slice(0, STEP_SOURCE_MAX_CHARS) } : null;
    default:
      return null;
  }
}

export function parseAiNameRequest(raw: unknown): AiNameRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const request = raw as Record<string, unknown>;
  if (!isString(request.id) || !request.id || !isString(request.providerUrl) || !request.providerUrl) return null;
  const source = parseSource(request.source);
  return source ? { id: request.id, providerUrl: request.providerUrl, source } : null;
}
