import { stepHasOutput } from './stepOutput';
import type { AvailableVarsInput, LoopVarHint } from './variableInsert';
import type { FlowDefinition, TriggerConfig } from '../../../../shared/types';
import { hasFileTrigger } from '../../../../shared/flowFileTrigger';

/** The trigger a step's Bot fields describe: the flow's first Bot trigger, else its main one. */
export function flowBotTrigger(flow: FlowDefinition): TriggerConfig {
  return [flow.trigger, ...(flow.extraTriggers ?? [])].find((tr) => tr.type === 'bot') ?? flow.trigger;
}

/**
 * What the step at `index` can take from the flow, for its Insert data menu and its draft button.
 * Built when one of those opens, from the flow as it is then, instead of handing every card arrays
 * of the steps before it: those arrays change with every keystroke anywhere above, so each card
 * would draw again on each key.
 */
export function stepVarInput(flow: FlowDefinition, index: number): AvailableVarsInput {
  const allPrevSteps = flow.steps.slice(0, Math.max(0, index));
  const loopVars: LoopVarHint[] = [];
  allPrevSteps.forEach((step, i) => {
    if (step.type === 'loop') {
      const inputRef = /\{\{\s*([^}]+?)\s*\}\}/.exec(step.config.input ?? '')?.[1]?.trim().split('.')[0];
      const sourceType = inputRef ? flow.steps.slice(0, i).find((s) => s.outputKey === inputRef)?.type : undefined;
      loopVars.push({ name: step.config.loopVar || 'item', sourceType });
    } else if (step.type === 'end_loop') {
      loopVars.pop();
    }
  });
  const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
  return {
    prevSteps: allPrevSteps.filter(stepHasOutput),
    allPrevSteps,
    flowTrigger: flowBotTrigger(flow),
    hasHotkeyTrigger: triggers.some((tr) => tr.type === 'hotkey'),
    hasFileTrigger: hasFileTrigger(triggers),
    loopVars,
    flowVariables: flow.variables ?? [],
  };
}
