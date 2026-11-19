import { loopVarName } from './flowBlockStructure';
import { escapeRegExp } from './regex';
import type { SkillInstance } from './types';

/*
 * Renaming a step's output (its outputKey) and every `{{reference}}` to it in one go, so the steps
 * downstream keep reading it. A reference is `{{key}}` or `{{key.field}}` in any config value;
 * outputKeys are unique in a flow, so the rewrite cannot reach another step's output. Inside a loop
 * whose variable has the same name, `{{key}}` means the loop's item, so that body is left alone.
 */

/** `{{from…}}` to `{{to…}}` (`{{ from }}`, `{{from.field}}`), never `{{fromX}}`. */
export function renameReferences(text: string, renames: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [from, to] of renames) {
    out = out.replace(new RegExp(`\\{\\{(\\s*)${escapeRegExp(from)}(?=[\\s.}])`, 'g'), `{{$1${to}`);
  }
  return out;
}

function referencePattern(name: string): RegExp {
  return new RegExp(`\\{\\{\\s*${escapeRegExp(name)}(?=[\\s.}])`, 'g');
}

interface StepShape {
  type?: unknown;
  config?: unknown;
}

function stringConfig(step: StepShape): Record<string, string> {
  const config = step.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return Object.fromEntries(Object.entries(config).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** Which steps sit in a loop whose variable is `name` (there `{{name}}` is the loop's item). */
function shadowedBy(steps: readonly StepShape[], name: string): boolean[] {
  const open: string[] = [];
  return steps.map((step) => {
    if (step?.type === 'end_loop') open.pop();
    const shadowed = open.includes(name);
    if (step?.type === 'loop') open.push(loopVarName({ config: stringConfig(step) }));
    return shadowed;
  });
}

/** How many `{{name…}}` references to a step's output the flow has (what a rename would rewrite). */
export function countOutputReferences(steps: readonly SkillInstance[], name: string): number {
  if (!name) return 0;
  const shadowed = shadowedBy(steps, name);
  let count = 0;
  steps.forEach((step, index) => {
    if (shadowed[index]) return;
    for (const value of Object.values(step.config)) count += value.match(referencePattern(name))?.length ?? 0;
  });
  return count;
}

/**
 * The steps with every reference to output `from` pointing at `to` instead; a step with nothing to
 * rewrite is returned as it was (the same object), so callers can tell which ones changed.
 */
export function renameOutputReferences<T extends StepShape>(steps: readonly T[], from: string, to: string): T[] {
  if (!from || !to || from === to) return [...steps];
  const shadowed = shadowedBy(steps, from);
  const renames = new Map([[from, to]]);
  return steps.map((step, index) => {
    if (shadowed[index] || !step?.config || typeof step.config !== 'object') return step;
    let changed = false;
    const config = Object.fromEntries(Object.entries(step.config as Record<string, unknown>).map(([key, value]) => {
      if (typeof value !== 'string') return [key, value];
      const next = renameReferences(value, renames);
      if (next !== value) changed = true;
      return [key, next];
    }));
    return changed ? { ...step, config } : step;
  });
}

function trimmedKey(step: unknown): string {
  const key = (step as { outputKey?: unknown } | null)?.outputKey;
  return typeof key === 'string' ? key.trim() : '';
}

function stepId(step: unknown): string {
  const id = (step as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id.trim() : '';
}

/**
 * A revision (the model's whole flow again) that renamed a kept step's outputKey: the references it
 * left on the old name are carried to the new one before the reply is checked, so a rename never
 * breaks a step the model forgot to update. Only when no step of the revision still produces the
 * old name (then a reference to it is the renamed one, not another step's).
 */
export function carryRenamedOutputKeys(original: readonly SkillInstance[], revised: readonly unknown[]): unknown[] {
  const before = new Map(original.map((step) => [step.id, step.outputKey?.trim() ?? '']));
  const produced = new Set(revised.map(trimmedKey).filter(Boolean));
  let steps = [...revised];
  for (const step of revised) {
    const from = before.get(stepId(step)) ?? '';
    const to = trimmedKey(step);
    if (!from || !to || from === to || produced.has(from)) continue;
    steps = renameOutputReferences(steps as StepShape[], from, to);
  }
  return steps;
}
