import type { SkillInstance, SkillType } from '../../../../../shared/types';

type Opener = 'if' | 'loop';

export type StructureIssue =
  | { kind: 'unclosed' }
  | { kind: 'unmatched' }
  /** A closer met another kind of block still open (at `open`). */
  | { kind: 'crossed'; open: number }
  | { kind: 'outsideLoop' };

export interface StepPlace {
  /** The if/loop steps open around this step, outermost first. */
  enclosing: ReadonlyArray<{ type: Opener; index: number }>;
  /** For an end marker: the opener it closes; for an opener: its end marker. */
  partner: number | null;
  issue: StructureIssue | null;
}

const CLOSES: Partial<Record<SkillType, Opener>> = { end_if: 'if', end_loop: 'loop' };
const cache = new WeakMap<readonly SkillInstance[], StepPlace[]>();

/**
 * Where each step sits in the if/loop nesting, with every structure problem rather than only the
 * first: the same single stack as `checkBlockStructure` (blocks close in nesting order), so the
 * outline marks what the runner would refuse or misread, row by row.
 */
export function flowPlaces(steps: readonly SkillInstance[]): StepPlace[] {
  const cached = cache.get(steps);
  if (cached) return cached;
  const open: Array<{ type: Opener; index: number }> = [];
  const places: StepPlace[] = steps.map(() => ({ enclosing: [], partner: null, issue: null }));
  steps.forEach((step, index) => {
    const place = places[index];
    const closes = CLOSES[step.type];
    if (closes) {
      const innermost = open.at(-1);
      place.enclosing = open.slice(0, -1);
      if (!innermost) {
        place.enclosing = [];
        place.issue = { kind: 'unmatched' };
      } else if (innermost.type !== closes) {
        place.enclosing = [...open];
        place.issue = { kind: 'crossed', open: innermost.index };
      } else {
        open.pop();
        place.partner = innermost.index;
        places[innermost.index].partner = index;
      }
      return;
    }
    place.enclosing = [...open];
    if (step.type === 'if' || step.type === 'loop') open.push({ type: step.type, index });
    if ((step.type === 'break' || step.type === 'continue') && !open.some((block) => block.type === 'loop')) {
      place.issue = { kind: 'outsideLoop' };
    }
  });
  for (const block of open) places[block.index].issue = { kind: 'unclosed' };
  cache.set(steps, places);
  return places;
}

export function placeOf(steps: readonly SkillInstance[], index: number): StepPlace {
  return flowPlaces(steps)[index] ?? { enclosing: [], partner: null, issue: null };
}

/** The innermost open loop around a step, or null. */
export function innermostLoop(steps: readonly SkillInstance[], index: number): number | null {
  return [...placeOf(steps, index).enclosing].reverse().find((block) => block.type === 'loop')?.index ?? null;
}
