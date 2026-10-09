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
 * One stack for both block types, so blocks must close in nesting order. Separate depth counters
 * would accept `if, loop, end_if, X, end_loop`, and the executor would then end a false `if` at
 * the crossed `end_if` and run X, the step it was meant to guard.
 */
export function checkBlockStructure(steps: ReadonlyArray<{ type: SkillType }>): BlockIssue | null {
  const open: Array<{ type: BlockOpener; index: number }> = [];
  for (let i = 0; i < steps.length; i++) {
    const type = steps[i].type;
    if (type === 'if' || type === 'loop') {
      open.push({ type, index: i });
      continue;
    }
    if (type === 'end_if' || type === 'end_loop') {
      const innermost = open.at(-1);
      if (!innermost) return { kind: 'unmatched', index: i, closer: type };
      if (innermost.type !== CLOSES[type]) return { kind: 'crossed', index: i, closer: type, open: innermost.type };
      open.pop();
      continue;
    }
    if ((type === 'break' || type === 'continue') && !open.some((block) => block.type === 'loop')) {
      return { kind: 'outsideLoop', index: i, type };
    }
  }
  const unclosed = open.at(-1);
  return unclosed ? { kind: 'unclosed', index: unclosed.index, open: unclosed.type } : null;
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
