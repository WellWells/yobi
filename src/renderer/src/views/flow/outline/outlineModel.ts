import type { SkillInstance, SkillType } from '../../../../../shared/types';
import type { StepSearchEntry, StepSearchField } from '../stepSummary';

const OPENERS: ReadonlySet<SkillType> = new Set<SkillType>(['loop', 'if']);
const CLOSERS: ReadonlySet<SkillType> = new Set<SkillType>(['end_loop', 'end_if']);

/** What a row says about its step: the outline's two lines and how sure it is of them. */
export interface RowText {
  primary: string;
  secondary?: string;
  /** `unset`: required settings missing; `error`/`warning`: `issue` says why. */
  state?: 'ok' | 'unset' | 'error' | 'warning';
  issue?: string;
}

export interface OutlineRow {
  step: SkillInstance;
  index: number;
  depth: number;
  /** The loops and conditions it is inside, outermost first. */
  ancestors: string[];
  /** For an end marker, a break or a continue: the loop or condition it belongs to. */
  owner?: string;
  /** For a loop or condition: how many steps are inside it, its end excluded. */
  childCount?: number;
  /** A comment's section: the steps up to the next comment at its level. */
  sectionCount?: number;
}

/**
 * The flow as a tree, in step order: depth and ancestors by the same stack the executor checks
 * blocks with, so an unmatched or crossed end still gets a row (at the depth it was written).
 */
export function outlineRows(steps: readonly SkillInstance[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const stack: { id: string; type: SkillType; row: OutlineRow }[] = [];
  steps.forEach((step, index) => {
    if (CLOSERS.has(step.type)) {
      const want = step.type === 'end_loop' ? 'loop' : 'if';
      const at = stack.map((frame) => frame.type).lastIndexOf(want);
      const owner = at >= 0 ? stack[at] : undefined;
      if (owner) {
        owner.row.childCount = index - owner.row.index - 1;
        stack.splice(at);
      }
      rows.push({ step, index, depth: stack.length, ancestors: stack.map((frame) => frame.id), owner: owner?.id });
      return;
    }
    const row: OutlineRow = { step, index, depth: stack.length, ancestors: stack.map((frame) => frame.id) };
    if (step.type === 'break' || step.type === 'continue') {
      row.owner = [...stack].reverse().find((frame) => frame.type === 'loop')?.id;
    }
    rows.push(row);
    if (OPENERS.has(step.type)) stack.push({ id: step.id, type: step.type, row });
  });
  // A comment heads the steps after it, until the next comment at its level or the end of its block.
  rows.forEach((row, i) => {
    if (row.step.type !== 'comment') return;
    let count = 0;
    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j];
      if (next.depth < row.depth) break;
      if (next.step.type === 'comment' && next.depth <= row.depth) break;
      count++;
    }
    row.sectionCount = count;
  });
  return rows;
}

/** Rows hidden because an ancestor (or the comment heading their section) is folded. */
export function hiddenByFold(rows: readonly OutlineRow[], folded: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>();
  rows.forEach((row, i) => {
    if (!folded.has(row.step.id)) return;
    const count = row.childCount !== undefined ? row.childCount + 1 : (row.sectionCount ?? 0);
    for (let j = i + 1; j <= i + count && j < rows.length; j++) hidden.add(rows[j].step.id);
  });
  return hidden;
}

export interface RowMatch {
  field: StepSearchField;
  /** The text around the hit, the hit itself separately so it can be drawn bold; all empty for code. */
  before: string;
  hit: string;
  after: string;
}

const CONTEXT_CHARS = 12;

function excerpt(text: string, at: number, length: number): Omit<RowMatch, 'field'> {
  const flat = text.replace(/\s+/g, ' ');
  // Offsets move when whitespace collapses: find the hit again in the flattened text.
  const needle = text.slice(at, at + length).replace(/\s+/g, ' ');
  const pos = Math.max(0, flat.toLowerCase().indexOf(needle.toLowerCase()));
  const start = Math.max(0, pos - CONTEXT_CHARS);
  const end = Math.min(flat.length, pos + needle.length + CONTEXT_CHARS);
  return {
    before: `${start > 0 ? '…' : ''}${flat.slice(start, pos)}`,
    hit: flat.slice(pos, pos + needle.length),
    after: `${flat.slice(pos + needle.length, end)}${end < flat.length ? '…' : ''}`,
  };
}

/**
 * Why a step is a result for `query` (case-insensitive): the first of its searchable texts
 * (`stepSearchText`, in the order the user most likely meant: name, kind, output, summary, then its
 * settings) that has it. Code still matches, without an excerpt: it holds tokens and passwords.
 */
export function matchRow(entries: readonly StepSearchEntry[], query: string): RowMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const entry of entries) {
    const at = entry.text.toLowerCase().indexOf(q);
    if (at < 0) continue;
    return entry.excerpt ? { field: entry.field, ...excerpt(entry.text, at, q.length) } : { field: entry.field, before: '', hit: '', after: '' };
  }
  return null;
}

/** A search's rows: the hits, and their ancestors drawn faint so a hit shows where it sits. */
export function searchRows(
  rows: readonly OutlineRow[],
  matches: ReadonlyMap<string, RowMatch>,
): { row: OutlineRow; context: boolean }[] {
  const keep = new Set<string>();
  for (const row of rows) {
    if (!matches.has(row.step.id)) continue;
    keep.add(row.step.id);
    row.ancestors.forEach((id) => keep.add(id));
  }
  return rows.filter((row) => keep.has(row.step.id)).map((row) => ({ row, context: !matches.has(row.step.id) }));
}

/** Where the selection goes when its step is deleted: next at its level, else previous, else its block. */
export function selectionAfterDelete(rows: readonly OutlineRow[], deletedId: string): string | undefined {
  const at = rows.findIndex((row) => row.step.id === deletedId);
  if (at < 0) return undefined;
  const row = rows[at];
  const parent = row.ancestors[row.ancestors.length - 1];
  const sibling = (r: OutlineRow): boolean => r.ancestors[r.ancestors.length - 1] === parent && !CLOSERS.has(r.step.type);
  const end = row.childCount !== undefined ? at + row.childCount + 1 : at;
  const next = rows.slice(end + 1).find(sibling);
  if (next) return next.step.id;
  const prev = [...rows.slice(0, at)].reverse().find(sibling);
  return prev?.step.id ?? parent;
}

const REF_HEAD = /\{\{\s*([A-Za-z_][\w-]*)/g;

/**
 * Which later steps read each step's output (`{{key}}`, `{{key.field}}`), by step number, for the
 * outline's tooltip: what breaks if this step is deleted or renamed.
 */
export function usedBy(steps: readonly SkillInstance[]): Map<string, number[]> {
  const producer = new Map<string, string>();
  const users = new Map<string, number[]>();
  steps.forEach((step, index) => {
    const seen = new Set<string>();
    for (const value of Object.values(step.config)) {
      if (typeof value !== 'string') continue;
      for (const match of value.matchAll(REF_HEAD)) {
        const owner = producer.get(match[1]);
        if (!owner || owner === step.id || seen.has(owner)) continue;
        seen.add(owner);
        users.set(owner, [...(users.get(owner) ?? []), index + 1]);
      }
    }
    if (step.outputKey?.trim()) producer.set(step.outputKey.trim(), step.id);
  });
  return users;
}
