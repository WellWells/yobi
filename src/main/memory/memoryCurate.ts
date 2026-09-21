import { MEMORY_CURATE_OPS, MEMORY_CURATE_WHY_MAX_CHARS } from '../../shared/memoryCurate';
import type { MemoryCurateChange, MemoryCurateOp, MemoryCuratePick } from '../../shared/memoryCurate';
import { cleanMemoryText, memoryDedupeKey, memoryIdNumber, MEMORY_ENTRY_MAX_CHARS } from '../../shared/userMemory';
import type { UserMemoryEntry } from '../../shared/userMemory';
import { editMemoryEntry, removeMemoryEntry } from './memoryState';
import type { UserMemoryState } from './memoryState';

export type CurateValidation = { ok: true; value: MemoryCurateChange[] } | { ok: false; error: string };

/** Enough for any memory that fits the cap; past it the model is listing things it made up. */
const MAX_PROPOSED_CHANGES = 60;

function idsOf(raw: Record<string, unknown>): string[] {
  const value = raw.ids ?? raw.id;
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list
    .map((item) => (typeof item === 'string' ? item.trim().replace(/^\[|\]$/g, '').toLowerCase() : ''))
    .filter((id) => Number.isFinite(memoryIdNumber(id))))];
}

type Checked = { change: Omit<MemoryCurateChange, 'key'> } | { reject: string };

function checkChange(
  raw: unknown,
  entries: ReadonlyMap<string, UserMemoryEntry>,
  used: ReadonlySet<string>,
  claimedTexts: ReadonlySet<string>,
): Checked {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reject: 'a change is not an object' };
  const item = raw as Record<string, unknown>;
  const op = String(item.op ?? '').trim().toLowerCase() as MemoryCurateOp;
  if (!MEMORY_CURATE_OPS.includes(op)) return { reject: `unknown op "${String(item.op ?? '')}"` };
  const ids = idsOf(item);
  const unknown = ids.find((id) => !entries.has(id));
  if (ids.length === 0 || unknown) return { reject: `${op} names an id that does not exist${unknown ? ` (${unknown})` : ''}` };
  const taken = ids.find((id) => used.has(id));
  if (taken) return { reject: `${taken} already appears in an earlier change` };
  if (op === 'merge' && ids.length < 2) return { reject: 'a merge needs at least two ids' };
  if (op === 'rewrite' && ids.length !== 1) return { reject: 'a rewrite takes exactly one id' };

  const before = ids.map((id) => ({ id, text: entries.get(id)!.text }));
  const why = cleanMemoryText(String(item.why ?? item.reason ?? '')).slice(0, MEMORY_CURATE_WHY_MAX_CHARS);
  const sure = item.sure !== false;
  if (op === 'remove') return { change: { op, ids, why, sure, before } };

  const text = cleanMemoryText(String(item.text ?? ''));
  if (!text) return { reject: `${op} of ${ids.join(', ')} has no text` };
  if (text.length > MEMORY_ENTRY_MAX_CHARS) return { reject: `${op} of ${ids.join(', ')} is longer than ${MEMORY_ENTRY_MAX_CHARS} characters` };
  const key = memoryDedupeKey(text);
  if (op === 'rewrite' && key === memoryDedupeKey(before[0].text)) return { reject: `rewrite of ${ids[0]} does not change it` };
  const clash = [...entries.values()].find((entry) => !ids.includes(entry.id) && memoryDedupeKey(entry.text) === key);
  if (clash || claimedTexts.has(key)) return { reject: `${op} of ${ids.join(', ')} repeats ${clash?.id ?? 'another change'}` };
  return { change: { op, ids, text, why, sure, before } };
}

/**
 * Turns the model's JSON into changes the review screen can show. A bad change is dropped rather
 * than sent back — a repair is a whole round trip, and the rest of the proposal is still good.
 * Only a reply with no usable shape, or one where every change was bad, is refused.
 */
export function validateCurateReply(json: unknown, entries: readonly UserMemoryEntry[]): CurateValidation {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray((json as Record<string, unknown>).changes)) {
    return { ok: false, error: 'Reply with one JSON object that has a "changes" array' };
  }
  const proposed = ((json as Record<string, unknown>).changes as unknown[]).slice(0, MAX_PROPOSED_CHANGES);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const used = new Set<string>();
  const claimedTexts = new Set<string>();
  const changes: MemoryCurateChange[] = [];
  const rejects: string[] = [];
  for (const raw of proposed) {
    const checked = checkChange(raw, byId, used, claimedTexts);
    if ('reject' in checked) {
      rejects.push(checked.reject);
      continue;
    }
    for (const id of checked.change.ids) used.add(id);
    if (checked.change.text) claimedTexts.add(memoryDedupeKey(checked.change.text));
    changes.push({ key: `c${changes.length + 1}`, ...checked.change });
  }
  if (proposed.length > 0 && changes.length === 0) {
    return { ok: false, error: `None of the proposed changes could be used: ${rejects.slice(0, 3).join('; ')}` };
  }
  return { ok: true, value: changes };
}

/** Every entry a change was proposed against still reads the way it did then. */
function stillAsProposed(state: UserMemoryState, change: MemoryCurateChange): boolean {
  return change.before.every((item) => state.entries.find((entry) => entry.id === item.id)?.text === item.text);
}

/** One change on its own copy of the state, so a change either lands whole or not at all. */
function applyOne(
  state: UserMemoryState,
  change: MemoryCurateChange,
  pick: MemoryCuratePick,
  now: string,
): UserMemoryState | null {
  if (change.op === 'remove') {
    return change.ids.reduce<UserMemoryState | null>((next, id) => {
      if (!next) return null;
      const removed = removeMemoryEntry(next, id);
      return removed.ok ? removed.state : null;
    }, state);
  }
  const text = pick.text !== undefined ? cleanMemoryText(pick.text) : change.text ?? '';
  const byUser = pick.text !== undefined && text !== change.text;
  // The lowest number survives: an old conversation that still names it keeps pointing at it.
  const survivor = [...change.ids].sort((a, b) => memoryIdNumber(a) - memoryIdNumber(b))[0];
  const createdAt = change.ids
    .map((id) => state.entries.find((entry) => entry.id === id)?.createdAt ?? '')
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  let next: UserMemoryState | null = state;
  for (const id of change.ids) {
    if (id === survivor || !next) continue;
    const removed = removeMemoryEntry(next, id);
    next = removed.ok ? removed.state : null;
  }
  if (!next) return null;
  const edited = editMemoryEntry(next, survivor, text, { now, byUser });
  if (!edited.ok) return null;
  if (!createdAt) return edited.state;
  return {
    ...edited.state,
    entries: edited.state.entries.map((entry) => (entry.id === survivor ? { ...entry, createdAt } : entry)),
  };
}

export interface CurationOutcome {
  state: UserMemoryState;
  applied: number;
  skipped: number;
  failed: number;
}

/**
 * Applies the changes the user ticked, in the order the model proposed them. A change whose
 * entries moved on while the user was reading is skipped: what they approved was a change to the
 * text they saw, not to whatever is there now.
 */
export function applyCuration(
  state: UserMemoryState,
  changes: readonly MemoryCurateChange[],
  picks: readonly MemoryCuratePick[],
  now: string,
): CurationOutcome {
  const picked = new Map(picks.map((pick) => [pick.key, pick]));
  let next = state;
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const change of changes) {
    const pick = picked.get(change.key);
    if (!pick) continue;
    if (!stillAsProposed(next, change)) {
      skipped += 1;
      continue;
    }
    const result = applyOne(next, change, pick, now);
    if (result) {
      next = result;
      applied += 1;
    } else {
      failed += 1;
    }
  }
  return { state: next, applied, skipped, failed };
}

/** What "undo" puts back, held only until the memory changes again. */
export interface CurationUndo {
  before: UserMemoryEntry[];
  after: UserMemoryEntry[];
}

export function sameEntries(a: readonly UserMemoryEntry[], b: readonly UserMemoryEntry[]): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index];
    return entry.id === other.id && entry.text === other.text && entry.updatedAt === other.updatedAt && entry.createdAt === other.createdAt;
  });
}

/**
 * Puts the entries back as they were before the tidy, if nothing has changed since. The id counter
 * is left where it is: a tidy never hands out ids, and the counter never runs backwards.
 */
export function undoCuration(state: UserMemoryState, undo: CurationUndo): UserMemoryState | null {
  if (!sameEntries(state.entries, undo.after)) return null;
  return { ...state, entries: undo.before.map((entry) => ({ ...entry })) };
}
