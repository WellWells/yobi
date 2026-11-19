import type { StepNameMaterial } from '../../../../../shared/flowAssist';
import { ASSIST_NAME_MAX_STEPS, isNumberedOutputKey } from '../../../../../shared/flowAssist';
import { FLOW_VAR_PREFIX } from '../../../../../shared/flowVariables';
import { HOTKEY_SELECTION_VAR, triggerInputVariables } from '../../../../../shared/flowReferenceCheck';
import { loopVarName } from '../../../../../shared/flowBlockStructure';
import { stepHasOutput } from '../stepOutput';
import type { FlowDefinition, SkillInstance } from '../../../../../shared/types';
import { stepSummary } from '../stepSummary';
import { isNamed } from '../stepSummary/core';
import type { StepSummaryContext } from '../stepSummary';
import { hasLabelField } from '../stepLabelRules';

/*
 * What the assistant's requests carry, built from what the editor already shows: each step's
 * summary line (never its code, headers or chat ids — `stepSummary` leaves those out) and the
 * editor's own problem list.
 */

export function nameableSteps(flow: FlowDefinition): SkillInstance[] {
  return flow.steps.filter((step) => hasLabelField(step.type));
}

/**
 * The steps the Name steps button names: the ones still called by their kind; when every step has a name
 * already, all of them (the user asked for better names). At most `ASSIST_NAME_MAX_STEPS`.
 */
export function namingTargets(flow: FlowDefinition, t: (key: string) => string): string[] {
  const nameable = nameableSteps(flow);
  const unnamed = nameable.filter((step) => !isNamed(step, t));
  return (unnamed.length > 0 ? unnamed : nameable).slice(0, ASSIST_NAME_MAX_STEPS).map((step) => step.id);
}

export function stepNameMaterial(
  flow: FlowDefinition,
  t: (key: string) => string,
  context: Omit<StepSummaryContext, 'index'>,
): StepNameMaterial[] {
  return flow.steps.map((step, index) => {
    const summary = stepSummary(step, { ...context, index });
    const named = isNamed(step, t);
    // A named step's summary leads with its name; what it does is the other line.
    const what = [summary.primary, summary.secondary].filter((line): line is string => Boolean(line && line !== step.label.trim()));
    return {
      id: step.id,
      index: index + 1,
      type: step.type,
      typeName: t(`flow.skill.${step.type}`),
      label: named ? step.label.trim() : '',
      summary: what.join(' · '),
      outputKey: stepHasOutput(step) ? step.outputKey.trim() : '',
    };
  });
}

/**
 * The steps the Name outputs button names: the ones whose output still has the editor's numbered
 * name (`llm_1`); when none has, all that hand on an output. At most `ASSIST_NAME_MAX_STEPS`.
 */
export function outputKeyTargets(flow: FlowDefinition): string[] {
  const keyed = flow.steps.filter((step) => stepHasOutput(step) && step.outputKey.trim());
  const numbered = keyed.filter((step) => isNumberedOutputKey(step.outputKey));
  return (numbered.length > 0 ? numbered : keyed).slice(0, ASSIST_NAME_MAX_STEPS).map((step) => step.id);
}

/** Names a step's output may not take: the built-ins, the flow's loop variables and trigger inputs. */
export function reservedOutputNames(flow: FlowDefinition): string[] {
  const loops = flow.steps.filter((step) => step.type === 'loop').map((step) => loopVarName(step));
  const triggers = triggerInputVariables([flow.trigger, ...(flow.extraTriggers ?? [])]);
  return [...new Set(['clipboard', 'timestamp', 'flow', FLOW_VAR_PREFIX, HOTKEY_SELECTION_VAR, 'file', 'bot', 'input', ...loops, ...triggers])];
}
