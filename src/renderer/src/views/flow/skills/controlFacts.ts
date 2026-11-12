import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../../../store/useFlowStore';
import { OUTPUT_KEY_RE } from '../../../../../shared/flowValidation';
import { loopVarName } from '../../../../../shared/flowBlockStructure';
import type { SkillInstance, SkillType } from '../../../../../shared/types';
import { describeRef, placeOf, scopeAt } from '../stepSummary';
import { innermostLoop } from '../stepSummary/structure';
import { RESERVED_NAMES } from '../stepSummary/control';
import { loopSubfields } from '../variableInsert';

/*
 * What a control step's form says about where it sits in the flow (the source of a loop, the
 * range of a condition, the stop after an on_change). Each form reads its facts through one
 * selector that returns primitives only, so an edit elsewhere redraws an open form just when its
 * sentence changes, and a closed card (no form mounted) never.
 */

type T = (key: string) => string;

/** Steps whose output is text, never a list: a loop over one runs no item. */
const TEXT_OUTPUT_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>([
  'llm', 'text', 'translate', 'browser', 'youtube', 'file_read', 'weather', 'forex', 'almanac', 'sysinfo', 'clipboard',
]);

/** Sub-fields that hold the list of a step whose own output is not one. */
const LIST_FIELDS: Partial<Record<SkillType, string>> = { x_thread: 'replies', research: 'sources' };

const WHOLE_REF_RE = /^\{\{\s*([^{}]+?)\s*\}\}$/;

export type LoopVarProblem = 'format' | 'reserved' | 'outer' | 'output' | '';

export interface LoopFacts {
  /** Why the variable name cannot be used ('format', 'reserved') or hides something ('outer', 'output'). */
  varProblem: LoopVarProblem;
  /** The step (#N) whose loop variable or output it hides. */
  varConflict: string;
  /** Where the list comes from, in words ("#2 讀取訂閱"); empty when it reads nothing that resolves. */
  source: string;
  /** The fields each item has, joined for the sentence; empty when not known. */
  fields: string;
  /** The first fields, for the example under the form. */
  exampleFields: string;
  /** The source is a list of plain values (no fields). */
  plain: boolean;
  /** The source is a step whose output is text, not a list. */
  notList: boolean;
}

const NO_LOOP_FACTS: LoopFacts = { varProblem: '', varConflict: '', source: '', fields: '', exampleFields: '', plain: false, notList: false };

function loopVarProblem(steps: readonly SkillInstance[], index: number): Pick<LoopFacts, 'varProblem' | 'varConflict'> {
  const step = steps[index];
  const name = loopVarName(step);
  if (!OUTPUT_KEY_RE.test(name)) return { varProblem: 'format', varConflict: '' };
  if (RESERVED_NAMES.has(name)) return { varProblem: 'reserved', varConflict: '' };
  const outer = [...scopeAt(steps, index).loops].reverse().find((loop) => loop.name === name);
  if (outer) return { varProblem: 'outer', varConflict: `#${outer.index + 1}` };
  const output = steps.findIndex((other) => other.outputKey?.trim() === name && other.id !== step.id);
  if (output >= 0) return { varProblem: 'output', varConflict: `#${output + 1}` };
  return { varProblem: '', varConflict: '' };
}

/** What the loop at `index` reads and what it binds, for its form. */
export function loopFacts(steps: readonly SkillInstance[], index: number, t: T): LoopFacts {
  const step = steps[index];
  if (step?.type !== 'loop') return NO_LOOP_FACTS;
  const facts: LoopFacts = { ...NO_LOOP_FACTS, ...loopVarProblem(steps, index) };
  const ref = WHOLE_REF_RE.exec((step.config.input ?? '').trim())?.[1];
  if (!ref) return facts;
  const described = describeRef(ref, { t, steps, index });
  if (!described.resolved) return facts;
  facts.source = described.text;
  if (described.kind !== 'step' || described.stepIndex === undefined) return facts;
  const sourceType = steps[described.stepIndex].type;
  const subPath = ref.split('.').slice(1).join('.');
  if (subPath && LIST_FIELDS[sourceType] !== subPath) return facts;
  if (!subPath && TEXT_OUTPUT_SKILLS.has(sourceType)) return { ...facts, notList: true };
  if (!subPath && LIST_FIELDS[sourceType]) return facts;
  const fields = loopSubfields(sourceType);
  if (fields.length === 0) return { ...facts, plain: true };
  return { ...facts, fields: fields.join(t('flow.summary.sep')), exampleFields: fields.slice(0, 2).join(',') };
}

/**
 * How many `{{name}}` / `{{name.x}}` the body of the loop at `index` holds, leaving out inner
 * loops that bind the same name (there it means their item).
 */
export function loopVarRefCount(steps: readonly SkillInstance[], index: number, name: string): number {
  return loopVarRefSteps(steps, index, name).reduce((sum, entry) => sum + entry.count, 0);
}

function refPattern(name: string): RegExp {
  return new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s.}])`, 'g');
}

/** The body steps of the loop at `index` that read `{{name}}`, with how many times each does. */
export function loopVarRefSteps(steps: readonly SkillInstance[], index: number, name: string): Array<{ index: number; count: number }> {
  const end = placeOf(steps, index).partner;
  if (!name || end === null || !OUTPUT_KEY_RE.test(name)) return [];
  const found: Array<{ index: number; count: number }> = [];
  for (let i = index + 1; i < end; i++) {
    const step = steps[i];
    if (step.type === 'loop' && loopVarName(step) === name) {
      const innerEnd = placeOf(steps, i).partner;
      if (innerEnd !== null) {
        i = innerEnd;
        continue;
      }
    }
    const count = Object.values(step.config).reduce((sum, value) => sum + (typeof value === 'string' ? (value.match(refPattern(name)) ?? []).length : 0), 0);
    if (count > 0) found.push({ index: i, count });
  }
  return found;
}

export interface IfFacts {
  /** The first and last step it guards (#N, 1-based); 0 when it has none. */
  from: number;
  to: number;
  /** How many steps it guards; -1 when it has no end. */
  count: number;
}

/** The steps the condition at `index` decides on. */
export function ifFacts(steps: readonly SkillInstance[], index: number): IfFacts {
  const end = steps[index]?.type === 'if' ? placeOf(steps, index).partner : null;
  if (end === null) return { from: 0, to: 0, count: -1 };
  const count = end - index - 1;
  return count > 0 ? { from: index + 2, to: end, count } : { from: 0, to: 0, count: 0 };
}

export interface OnChangeFacts {
  /** The stop step (#N) right after it that reads its output; 0 when there is none. */
  stopAt: number;
  /** That stop is inside a loop, so it skips the item instead of ending the run. */
  stopInLoop: boolean;
}

/** Whether a stop step follows the on_change at `index` and reads its output. */
export function onChangeFacts(steps: readonly SkillInstance[], index: number): OnChangeFacts {
  const key = steps[index]?.outputKey?.trim();
  if (!key) return { stopAt: 0, stopInLoop: false };
  let next = index + 1;
  while (steps[next]?.type === 'comment') next++;
  const stop = steps[next];
  if (stop?.type !== 'stop' || WHOLE_REF_RE.exec((stop.config.value ?? '').trim())?.[1]?.split('.')[0] !== key) {
    return { stopAt: 0, stopInLoop: false };
  }
  return { stopAt: next + 1, stopInLoop: innermostLoop(steps, next) !== null };
}

/** Whether the stop step at `index` is inside a loop (it then skips the item, not the run). */
export function stopInLoop(steps: readonly SkillInstance[], index: number): boolean {
  return innermostLoop(steps, index) !== null;
}

/**
 * One fact object of the open flow's step, re-read on every store change but returned as the
 * same primitives (`useShallow`), so the form draws again only when a fact changes. Without a
 * flow (a form drawn on its own) it is `fallback`.
 */
export function useStepFacts<F extends object>(
  flowId: string | undefined,
  stepId: string,
  read: (steps: readonly SkillInstance[], index: number) => F,
  fallback: F,
): F {
  return useFlowStore(useShallow((state) => {
    const steps = flowId ? state.flows.find((flow) => flow.id === flowId)?.steps : undefined;
    const index = steps ? steps.findIndex((step) => step.id === stepId) : -1;
    return steps && index >= 0 ? read(steps, index) : fallback;
  }));
}

/** The value a step's field had when the flow was last saved; null for a step not saved yet. */
export function useSavedField(flowId: string | undefined, stepId: string, field: string): string | null {
  return useFlowStore((state) => {
    const saved = flowId ? state.savedFlows[flowId]?.steps.find((step) => step.id === stepId) : undefined;
    return saved ? saved.config[field] ?? '' : null;
  });
}
