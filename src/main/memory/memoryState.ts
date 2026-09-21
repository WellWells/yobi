import {
  cleanMemoryText,
  memoryDedupeKey,
  memoryIdNumber,
  memoryUsedChars,
  MEMORY_ENTRY_MAX_CHARS,
  MEMORY_MAX_OPS_PER_TURN,
  MEMORY_TOTAL_MAX_CHARS,
} from '../../shared/userMemory';
import type {
  MemoryEditFailure,
  MemoryNote,
  UserMemoryBotSelf,
  UserMemoryEntry,
  UserMemorySnapshot,
  UserMemorySource,
} from '../../shared/userMemory';
import type { MemoryOp } from './memoryProtocol';

export interface UserMemoryState {
  version: 1;
  enabled: boolean;
  /** The next id to hand out. Only ever grows, so a deleted id is never reused. */
  nextId: number;
  entries: UserMemoryEntry[];
  botSelf: UserMemoryBotSelf;
}

export function emptyMemoryState(): UserMemoryState {
  return { version: 1, enabled: true, nextId: 1, entries: [], botSelf: { telegram: [], line: [] } };
}

const SOURCES: readonly UserMemorySource[] = ['chat', 'agent', 'bot', 'manual'];

function idList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

export function normalizeMemoryState(raw: unknown): UserMemoryState {
  const base = emptyMemoryState();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const entries: UserMemoryEntry[] = [];
  for (const item of Array.isArray(obj.entries) ? obj.entries : []) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
    const text = typeof entry.text === 'string' ? cleanMemoryText(entry.text).slice(0, MEMORY_ENTRY_MAX_CHARS) : '';
    if (!Number.isFinite(memoryIdNumber(id)) || !text || seen.has(id)) continue;
    seen.add(id);
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString();
    const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt;
    const source = SOURCES.includes(entry.source as UserMemorySource) ? entry.source as UserMemorySource : 'manual';
    const conversation = typeof entry.conversation === 'string' ? entry.conversation.trim() : '';
    entries.push({
      id, text, createdAt, updatedAt, source,
      ...(entry.edited === true ? { edited: true as const } : {}),
      ...(conversation ? { conversation } : {}),
    });
  }
  entries.sort((a, b) => memoryIdNumber(a.id) - memoryIdNumber(b.id));
  const highest = entries.reduce((max, entry) => Math.max(max, memoryIdNumber(entry.id)), 0);
  const storedNext = Number(obj.nextId);
  const botSelf = (obj.botSelf && typeof obj.botSelf === 'object') ? obj.botSelf as Record<string, unknown> : {};
  return {
    version: 1,
    enabled: obj.enabled !== false,
    nextId: Math.max(highest + 1, Number.isFinite(storedNext) ? Math.floor(storedNext) : 1, 1),
    entries,
    botSelf: { telegram: idList(botSelf.telegram), line: idList(botSelf.line) },
  };
}

export function memorySnapshot(state: UserMemoryState): UserMemorySnapshot {
  return {
    enabled: state.enabled,
    entries: state.entries.map((entry) => ({ ...entry })),
    botSelf: { telegram: [...state.botSelf.telegram], line: [...state.botSelf.line] },
    usedChars: memoryUsedChars(state.entries),
    maxChars: MEMORY_TOTAL_MAX_CHARS,
    entryMaxChars: MEMORY_ENTRY_MAX_CHARS,
  };
}

export type MemoryStateOutcome =
  | { ok: true; state: UserMemoryState; entry: UserMemoryEntry }
  | { ok: false; reason: MemoryEditFailure };
type Outcome = MemoryStateOutcome;

function isDuplicate(state: UserMemoryState, text: string, exceptId?: string): boolean {
  const key = memoryDedupeKey(text);
  return state.entries.some((entry) => entry.id !== exceptId && memoryDedupeKey(entry.text) === key);
}

export function addMemoryEntry(
  state: UserMemoryState,
  rawText: string,
  meta: { source: UserMemorySource; now: string; conversation?: string },
): Outcome {
  const text = cleanMemoryText(rawText);
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MEMORY_ENTRY_MAX_CHARS) return { ok: false, reason: 'tooLong' };
  if (isDuplicate(state, text)) return { ok: false, reason: 'duplicate' };
  if (memoryUsedChars(state.entries) + text.length > MEMORY_TOTAL_MAX_CHARS) return { ok: false, reason: 'full' };
  const entry: UserMemoryEntry = {
    id: `m${state.nextId}`,
    text,
    createdAt: meta.now,
    updatedAt: meta.now,
    source: meta.source,
    ...(meta.conversation ? { conversation: meta.conversation } : {}),
  };
  return { ok: true, entry, state: { ...state, nextId: state.nextId + 1, entries: [...state.entries, entry] } };
}

export function editMemoryEntry(
  state: UserMemoryState,
  id: string,
  rawText: string,
  meta: { now: string; byUser: boolean },
): Outcome {
  const current = state.entries.find((entry) => entry.id === id);
  if (!current) return { ok: false, reason: 'notFound' };
  const text = cleanMemoryText(rawText);
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MEMORY_ENTRY_MAX_CHARS) return { ok: false, reason: 'tooLong' };
  if (isDuplicate(state, text, id)) return { ok: false, reason: 'duplicate' };
  if (memoryUsedChars(state.entries) - current.text.length + text.length > MEMORY_TOTAL_MAX_CHARS) {
    return { ok: false, reason: 'full' };
  }
  const entry: UserMemoryEntry = {
    ...current,
    text,
    updatedAt: meta.now,
    ...(meta.byUser ? { edited: true as const } : {}),
  };
  return { ok: true, entry, state: { ...state, entries: state.entries.map((item) => (item.id === id ? entry : item)) } };
}

export function removeMemoryEntry(state: UserMemoryState, id: string): Outcome {
  const current = state.entries.find((entry) => entry.id === id);
  if (!current) return { ok: false, reason: 'notFound' };
  return { ok: true, entry: current, state: { ...state, entries: state.entries.filter((entry) => entry.id !== id) } };
}

export interface ApplyContext {
  source: UserMemorySource;
  now: string;
  conversation?: string;
}

/**
 * Applies the changes a reply asked for and reports what really happened, one note per change
 * that landed or was refused for lack of room. Unknown ids, duplicates and no-op updates change
 * nothing and say nothing: the note is the user's only view of the memory changing, and a line
 * for something that did not change would be the same kind of false claim the notes exist to stop.
 *
 * A reply that asks for a review keeps only its additions: tidying rewrites and deletes entries,
 * and that happens on the review screen, one confirmed change at a time — never straight from a
 * reply, however sure the model was.
 */
export function applyMemoryOps(
  state: UserMemoryState,
  ops: readonly MemoryOp[],
  ctx: ApplyContext,
): { state: UserMemoryState; notes: MemoryNote[] } {
  const review = ops.find((op) => op.kind === 'review');
  const changes = review ? ops.filter((op) => op.kind === 'add') : ops.filter((op) => op.kind !== 'review');
  let next = state;
  const notes: MemoryNote[] = [];
  for (const op of changes.slice(0, MEMORY_MAX_OPS_PER_TURN)) {
    if (op.kind === 'add') {
      const added = addMemoryEntry(next, op.text, ctx);
      if (added.ok) {
        next = added.state;
        notes.push({ op: 'add', id: added.entry.id, text: added.entry.text });
      } else if (added.reason === 'full') {
        notes.push({ op: 'full', text: cleanMemoryText(op.text) });
      }
      continue;
    }
    if (op.kind === 'update') {
      const before = next.entries.find((entry) => entry.id === op.id);
      if (!before || memoryDedupeKey(before.text) === memoryDedupeKey(op.text)) continue;
      const edited = editMemoryEntry(next, op.id, op.text, { now: ctx.now, byUser: false });
      if (edited.ok) {
        next = edited.state;
        notes.push({ op: 'update', id: op.id, text: edited.entry.text, prev: before.text });
      } else if (edited.reason === 'full') {
        notes.push({ op: 'full', text: cleanMemoryText(op.text) });
      }
      continue;
    }
    if (op.kind !== 'forget') continue;
    const removed = removeMemoryEntry(next, op.id);
    if (removed.ok) {
      next = removed.state;
      notes.push({ op: 'forget', id: op.id, text: removed.entry.text });
    }
  }
  if (review) notes.push({ op: 'review', text: review.text });
  return { state: next, notes };
}

/**
 * Reverses one note if the memory still looks the way the note left it. A forgotten entry comes
 * back under its own id, so an old thread that still names it keeps pointing at the right one.
 */
export function undoMemoryNote(state: UserMemoryState, note: MemoryNote, now: string): UserMemoryState | null {
  if (!note.id) return null;
  const current = state.entries.find((entry) => entry.id === note.id);
  if (note.op === 'add') {
    if (current?.text !== note.text) return null;
    return { ...state, entries: state.entries.filter((entry) => entry.id !== note.id) };
  }
  if (note.op === 'update') {
    if (current?.text !== note.text || !note.prev) return null;
    const restored = { ...current, text: note.prev, updatedAt: now };
    return { ...state, entries: state.entries.map((entry) => (entry.id === note.id ? restored : entry)) };
  }
  if (note.op === 'forget') {
    if (current || memoryUsedChars(state.entries) + note.text.length > MEMORY_TOTAL_MAX_CHARS) return null;
    const entry: UserMemoryEntry = { id: note.id, text: note.text, createdAt: now, updatedAt: now, source: 'manual' };
    const entries = [...state.entries, entry].sort((a, b) => memoryIdNumber(a.id) - memoryIdNumber(b.id));
    return { ...state, entries, nextId: Math.max(state.nextId, memoryIdNumber(note.id) + 1) };
  }
  return null;
}
