import type { SkillType } from './types';

type BlockOpener = 'if' | 'loop';
type BlockCloser = 'end_if' | 'end_loop';

const CLOSES: Record<BlockCloser, BlockOpener> = { end_if: 'if', end_loop: 'loop' };

/** The first thing wrong with a flow's if/loop structure, by step index (0-based). */
export type BlockIssue =
  | { kind: 'crossed'; index: number; closer: BlockCloser; open: BlockOpener }
  | { kind: 'unmatched'; index: number; closer: BlockCloser }
  | { kind: 'outsideLoop'; index: number; type: 'break' | 'continue' }
  | { kind: 'unclosed'; index: number; open: BlockOpener };

/**
 * Shapes that run but do something the author rarely meant, by step index. Never a reason to
 * refuse a run or a build: they are shown in the editor only.
 */
export type BlockWarning =
  /** Nothing follows it inside its loop, so skipping "the rest of this item" skips nothing. */
  | { kind: 'continueLast'; index: number }
  /** Directly in a loop body, not under an if: break ends the loop on the first item; continue skips every later step. */
  | { kind: 'unconditional'; index: number; type: 'break' | 'continue' }
  /** Inside a loop, on_change compares each item with the previous item, not with the last run. */
  | { kind: 'onChangeInLoop'; index: number }
  /** The loop variable has the name of an enclosing loop's, which it hides for the whole body. */
  | { kind: 'shadowedLoopVar'; index: number; name: string; outer: number };

/** Every issue the editor shows, at most one per step; an error wins over a warning on the same step. */
export type StructureIssue = (BlockIssue & { severity: 'error' }) | (BlockWarning & { severity: 'warning' });

type StructureStep = { type: SkillType; config?: Record<string, string> };

/** The loop variable a loop step binds, as the executor trims it. */
export function loopVarName(step: { config?: Record<string, string> }): string {
  return step.config?.loopVar?.trim() || 'item';
}

/** Steps a `continue` may sit before and still be the last thing its loop does. */
const NO_OP_AFTER_CONTINUE = new Set<SkillType>(['end_if', 'comment']);

type OpenBlock = { type: BlockOpener; index: number };

/** The stack position of the innermost open block that matches, -1 for none. */
function innermostIndex(open: OpenBlock[], match: (block: OpenBlock) => boolean): number {
  for (let k = open.length - 1; k >= 0; k--) if (match(open[k])) return k;
  return -1;
}

function continueIsLast(steps: ReadonlyArray<StructureStep>, index: number): boolean {
  let j = index + 1;
  while (j < steps.length && NO_OP_AFTER_CONTINUE.has(steps[j].type)) j++;
  return steps[j]?.type === 'end_loop';
}

/**
 * One pass over one stack for both block types. Errors come in the order `checkBlockStructure`
 * would meet them (scan order, then the unclosed blocks innermost first), so its answer is
 * `errors[0]`. After an error the scan recovers the way a reader would: a crossing closer ends the
 * open block of its own kind beneath the innermost one (or is ignored when there is none), an
 * unmatched closer is ignored, so one misplaced marker is reported once, not once per later step.
 */
function scanBlocks(steps: ReadonlyArray<StructureStep>): { errors: BlockIssue[]; warnings: BlockWarning[] } {
  const errors: BlockIssue[] = [];
  const warnings: BlockWarning[] = [];
  const open: OpenBlock[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const type = step.type;
    if (type === 'if' || type === 'loop') {
      if (type === 'loop') {
        const name = loopVarName(step);
        const outer = innermostIndex(open, (block) => block.type === 'loop' && loopVarName(steps[block.index]) === name);
        if (outer >= 0) warnings.push({ kind: 'shadowedLoopVar', index: i, name, outer: open[outer].index });
      }
      open.push({ type, index: i });
      continue;
    }
    if (type === 'end_if' || type === 'end_loop') {
      const innermost = open.at(-1);
      if (!innermost) {
        errors.push({ kind: 'unmatched', index: i, closer: type });
        continue;
      }
      if (innermost.type !== CLOSES[type]) {
        errors.push({ kind: 'crossed', index: i, closer: type, open: innermost.type });
        const own = innermostIndex(open, (block) => block.type === CLOSES[type]);
        if (own >= 0) open.splice(own, 1);
        continue;
      }
      open.pop();
      continue;
    }
    if (type === 'break' || type === 'continue') {
      if (!open.some((block) => block.type === 'loop')) {
        errors.push({ kind: 'outsideLoop', index: i, type });
      } else if (type === 'continue' && continueIsLast(steps, i)) {
        warnings.push({ kind: 'continueLast', index: i });
      } else if (open.at(-1)?.type === 'loop') {
        warnings.push({ kind: 'unconditional', index: i, type });
      }
      continue;
    }
    if (type === 'on_change' && open.some((block) => block.type === 'loop')) {
      warnings.push({ kind: 'onChangeInLoop', index: i });
    }
  }
  for (const block of [...open].reverse()) errors.push({ kind: 'unclosed', index: block.index, open: block.type });
  return { errors, warnings };
}

/**
 * One stack for both block types, so blocks must close in nesting order. Separate depth counters
 * would accept `if, loop, end_if, X, end_loop`, and the executor would then end a false `if` at
 * the crossed `end_if` and run X, the step it was meant to guard.
 */
export function checkBlockStructure(steps: ReadonlyArray<{ type: SkillType }>): BlockIssue | null {
  return scanBlocks(steps).errors[0] ?? null;
}

/**
 * Every structure issue of a flow for the editor, sorted by step, at most one per step: the same
 * stack and the same first error as `checkBlockStructure` (which the executor and the AI build
 * still use), plus the warnings that never block anything.
 */
export function checkBlockStructureAll(steps: ReadonlyArray<StructureStep>): StructureIssue[] {
  const { errors, warnings } = scanBlocks(steps);
  const byStep = new Map<number, StructureIssue>();
  for (const error of errors) if (!byStep.has(error.index)) byStep.set(error.index, { ...error, severity: 'error' });
  for (const warning of warnings) if (!byStep.has(warning.index)) byStep.set(warning.index, { ...warning, severity: 'warning' });
  return [...byStep.values()].sort((a, b) => a.index - b.index);
}

/**
 * How deep each step is nested, counting every opener and closer alike (as the card list always
 * has). `closers: 'opener'` puts an end marker level with its start (the outline's end line);
 * `'body'` keeps it level with the body it closes (the card list). A stray closer stays at 0.
 */
export function nestingDepths(steps: ReadonlyArray<{ type: SkillType }>, closers: 'opener' | 'body' = 'opener'): number[] {
  let level = 0;
  return steps.map(({ type }) => {
    if (type === 'end_loop' || type === 'end_if') {
      const body = level;
      level = Math.max(0, level - 1);
      return closers === 'body' ? body : level;
    }
    const here = level;
    if (type === 'loop' || type === 'if') level++;
    return here;
  });
}

const MATCHING_MARKER: Partial<Record<SkillType, { other: SkillType; dir: 1 | -1 }>> = {
  loop: { other: 'end_loop', dir: 1 },
  if: { other: 'end_if', dir: 1 },
  end_loop: { other: 'loop', dir: -1 },
  end_if: { other: 'if', dir: -1 },
};

/**
 * The index of the marker that pairs with the one at `index`: forward from an opener to its
 * closer, backward from a closer to its opener, counting nested blocks of the same kind.
 * -1 when `index` is not a block marker or the block has no partner. The editor and the
 * executor both read a block's extent from here, so they cannot disagree about it.
 */
export function findMatchingMarker(steps: ReadonlyArray<{ type: SkillType }>, index: number): number {
  const type = steps[index]?.type;
  const entry = type ? MATCHING_MARKER[type] : undefined;
  if (!type || !entry) return -1;
  let depth = 1;
  for (let j = index + entry.dir; j >= 0 && j < steps.length; j += entry.dir) {
    if (steps[j].type === type) depth++;
    else if (steps[j].type === entry.other) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** The English, model-facing wording of a block issue (validation errors go back into the repair prompt). */
export function describeBlockIssue(issue: BlockIssue): string {
  const step = `Step ${issue.index + 1}`;
  switch (issue.kind) {
    case 'crossed':
      return `${step} ("${issue.closer}") closes a "${CLOSES[issue.closer]}" but the innermost open block is a "${issue.open}" — blocks must close in nesting order`;
    case 'unmatched':
      return `${step}: unmatched "${issue.closer}" without a preceding "${CLOSES[issue.closer]}"`;
    case 'outsideLoop':
      return `${step}: "${issue.type}" must be inside a loop`;
    case 'unclosed':
      return `${step}: unbalanced "${issue.open}" — it has no matching "end_${issue.open}"`;
  }
}
