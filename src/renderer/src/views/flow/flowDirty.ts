import type { FlowDefinition, SkillInstance } from '../../../../shared/types';

// A step object is never changed in place (the store replaces the edited one), so its JSON is
// worked out once per object. The draft keeps every untouched step's object across edits, so a
// keystroke serialises the edited step alone instead of the whole flow (a 200-step flow with long
// prompts is about half a megabyte).
const stepJson = new WeakMap<SkillInstance, string>();

function jsonOfStep(step: SkillInstance): string {
  let json = stepJson.get(step);
  if (json === undefined) {
    json = JSON.stringify(step);
    stepJson.set(step, json);
  }
  return json;
}

/**
 * Whether the draft differs from what was last saved. Same answer as comparing the two flows'
 * JSON (key order included), only without stringifying the steps that did not change.
 */
export function flowDiffersFromSaved(flow: FlowDefinition, saved: FlowDefinition | undefined): boolean {
  if (!saved) return true;
  if (flow === saved) return false;
  const { steps, ...rest } = flow;
  const { steps: savedSteps, ...savedRest } = saved;
  // JSON leaves out keys set to undefined, so they do not count here either.
  const keys = (value: object): string => Object.entries(value).filter(([, v]) => v !== undefined).map(([k]) => k).join('\n');
  if (keys(flow) !== keys(saved)) return true;
  if (JSON.stringify(rest) !== JSON.stringify(savedRest)) return true;
  if (steps.length !== savedSteps.length) return true;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] !== savedSteps[i] && jsonOfStep(steps[i]) !== jsonOfStep(savedSteps[i])) return true;
  }
  return false;
}
