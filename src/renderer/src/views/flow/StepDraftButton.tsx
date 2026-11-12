import React from 'react';
import { PromptAuthorButton } from '../../components/PromptAuthorButton';
import type { PromptDraftApply } from '../../components/PromptAuthorDialog';
import type { PromptAuthorKind, PromptDraftContext, PromptDraftVariable } from '../../../../shared/promptAuthor';
import { useFlowStore } from '../../store/useFlowStore';
import { availableVarGroups, type AvailableVarsInput } from './variableInsert';

/** A flow field a draft can write; the button sits on its label row. */
export type StepDraftKind = Extract<PromptAuthorKind, 'flowPrompt' | 'botMessage' | 'emailBody'>;

/** What a step form calls to put the draft button beside one of its fields. */
export type StepDraftButtonRender = (field: string, kind: StepDraftKind, fieldLabel: string) => React.ReactNode;

/** Every `{{…}}` the step's Insert data menu offers, each once, with its hint. */
export function stepDraftVariables(input: AvailableVarsInput, t: (key: string) => string): PromptDraftVariable[] {
  const seen = new Map<string, PromptDraftVariable>();
  for (const group of availableVarGroups(input, t)) {
    for (const { token, hint } of group.tokens) {
      const name = token.replace(/^\{\{|\}\}$/g, '').trim();
      if (!name || seen.has(name)) continue;
      seen.set(name, hint ? { name, hint } : { name });
    }
  }
  return [...seen.values()];
}

/**
 * Applies a draft to one field of one step's unsaved edit, by flow and step id — never "the card
 * now open". The field must still hold the text the draft was made from; otherwise nothing is
 * written. Saving stays with the editor's Save.
 */
export function applyStepDraft(flowId: string, stepId: string, field: string, draft: string, base: string): PromptDraftApply {
  const state = useFlowStore.getState();
  const step = state.flows.find((flow) => flow.id === flowId)?.steps.find((candidate) => candidate.id === stepId);
  if (!step || (step.config[field] ?? '') !== base) return 'changed';
  state.updateStep(flowId, stepId, { config: { ...step.config, [field]: draft } });
  return true;
}

interface Props {
  flowId: string;
  stepId: string;
  stepLabel: string;
  field: string;
  kind: StepDraftKind;
  fieldLabel: string;
  value: string;
  /** Read when the draft dialog asks for the data it may use. */
  varInput: () => AvailableVarsInput;
  t: (key: string) => string;
}

export const StepDraftButton: React.FC<Props> = ({ flowId, stepId, stepLabel, field, kind, fieldLabel, value, varInput, t }) => {
  const context = (): PromptDraftContext => {
    const flow = useFlowStore.getState().flows.find((candidate) => candidate.id === flowId);
    // Main refuses longer context fields; the start of a long description says enough.
    return {
      flowName: (flow?.name ?? '').slice(0, 200),
      flowDescription: (flow?.description ?? '').slice(0, 2_000),
      stepLabel: stepLabel.slice(0, 200),
    };
  };
  return (
    <PromptAuthorButton
      kind={kind}
      currentPrompt={value}
      t={t}
      fieldLabel={fieldLabel}
      variables={() => stepDraftVariables(varInput(), t)}
      context={context}
      onApply={async (draft, base) => applyStepDraft(flowId, stepId, field, draft, base)}
    />
  );
};
