import React from 'react';
import { claudeModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { selectedClaudeModel } from '../../../../shared/claudeModels';
import type { ClaudeModelChoice, ClaudeModelState } from '../../../../shared/claudeModels';
import { ProviderModelSubmenu, SubmenuSummaryText } from './ProviderModelSubmenu';
import type { ProviderSubmenuRowProps } from './ProviderModelSubmenu';

/**
 * Reflected in the menu at once; main's answer — and its broadcast to every window — settles it.
 * A different model hands effort and thinking back to the page, as main does.
 */
export function chooseClaudeModel(patch: Partial<ClaudeModelChoice>): void {
  const { claudeModels, setClaudeModels } = useAppStore.getState();
  if (claudeModels) {
    const current = claudeModels.choice;
    const base = patch.modelId !== undefined && patch.modelId !== current.modelId
      ? { ...current, effort: '', thinking: null }
      : current;
    setClaudeModels({ ...claudeModels, choice: { ...base, ...patch } });
  }
  void claudeModelApi.set(patch).then(setClaudeModels);
}

/** The chosen model ("Sonnet 5"). Effort and thinking have their own control in the composer. */
export const ClaudeModelSummary: React.FC<{ state: ClaudeModelState }> = ({ state }) => (
  <SubmenuSummaryText text={selectedClaudeModel(state)?.label} />
);

interface ClaudeModelSubmenuProps extends ProviderSubmenuRowProps {
  state: ClaudeModelState;
}

/** The Claude row, opening the models this account can pick. Picking one also picks Claude. */
export const ClaudeModelSubmenu: React.FC<ClaudeModelSubmenuProps> = ({ state, ...row }) => {
  if (!state.catalog) return null;
  return (
    <ProviderModelSubmenu
      {...row}
      entries={state.catalog.models}
      selectedModelId={state.choice.modelId}
      summary={<ClaudeModelSummary state={state} />}
      onPickModel={(modelId) => chooseClaudeModel({ modelId })}
    />
  );
};
