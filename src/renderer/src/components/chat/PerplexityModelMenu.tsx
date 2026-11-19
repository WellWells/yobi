import React from 'react';
import { perplexityModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { selectedPerplexityModel } from '../../../../shared/perplexityModels';
import type { PerplexityModelChoice, PerplexityModelState } from '../../../../shared/perplexityModels';
import { ProviderModelSubmenu, SubmenuSummaryText } from './ProviderModelSubmenu';
import type { ProviderSubmenuRowProps } from './ProviderModelSubmenu';

/** Reflected in the menu at once; main's answer — and its broadcast to every window — settles it. */
export function choosePerplexityModel(patch: Partial<PerplexityModelChoice>): void {
  const { perplexityModels, setPerplexityModels } = useAppStore.getState();
  if (perplexityModels) setPerplexityModels({ ...perplexityModels, choice: { ...perplexityModels.choice, ...patch } });
  void perplexityModelApi.set(patch).then(setPerplexityModels);
}

export const PerplexityModelSummary: React.FC<{ state: PerplexityModelState }> = ({ state }) => (
  <SubmenuSummaryText text={selectedPerplexityModel(state)?.label ?? null} />
);

interface PerplexityModelSubmenuProps extends ProviderSubmenuRowProps {
  state: PerplexityModelState;
}

/** The Perplexity row, opening the models the signed-in page offers. Picking one also picks Perplexity. */
export const PerplexityModelSubmenu: React.FC<PerplexityModelSubmenuProps> = ({ state, ...row }) => {
  if (!state.catalog) return null;
  return (
    <ProviderModelSubmenu
      {...row}
      entries={state.catalog.models}
      selectedModelId={state.choice.modelId}
      summary={<PerplexityModelSummary state={state} />}
      onPickModel={(modelId) => choosePerplexityModel({ modelId })}
    />
  );
};
