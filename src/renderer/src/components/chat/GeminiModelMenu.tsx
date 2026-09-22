import React from 'react';
import { geminiModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { geminiModelShortLabel, selectedGeminiModel } from '../../../../shared/geminiModels';
import type { GeminiModelChoice, GeminiModelState } from '../../../../shared/geminiModels';
import { ProviderModelSubmenu, SubmenuSummaryText } from './ProviderModelSubmenu';
import type { ProviderSubmenuRowProps } from './ProviderModelSubmenu';

/** Reflected in the menu at once; main's answer — and its broadcast to every window — settles it. */
export function chooseGeminiModel(patch: Partial<GeminiModelChoice>): void {
  const { geminiModels, setGeminiModels } = useAppStore.getState();
  if (geminiModels) setGeminiModels({ ...geminiModels, choice: { ...geminiModels.choice, ...patch } });
  void geminiModelApi.set(patch).then(setGeminiModels);
}

/** The page's own short form ("Flash-Lite"). Thinking has its own control in the composer. */
export const GeminiModelSummary: React.FC<{ state: GeminiModelState }> = ({ state }) => {
  const model = selectedGeminiModel(state);
  return <SubmenuSummaryText text={model ? geminiModelShortLabel(model.label) : null} />;
};

interface GeminiModelSubmenuProps extends ProviderSubmenuRowProps {
  state: GeminiModelState;
}

/** The Gemini row, opening the models the page offers. Picking one also picks Gemini. */
export const GeminiModelSubmenu: React.FC<GeminiModelSubmenuProps> = ({ state, ...row }) => {
  if (!state.catalog) return null;
  return (
    <ProviderModelSubmenu
      {...row}
      entries={state.catalog.models}
      selectedModelId={state.choice.modelId}
      summary={<GeminiModelSummary state={state} />}
      onPickModel={(modelId) => chooseGeminiModel({ modelId })}
    />
  );
};
