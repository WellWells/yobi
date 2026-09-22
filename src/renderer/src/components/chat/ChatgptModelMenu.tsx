import React from 'react';
import { chatgptModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { selectedChatgptModel } from '../../../../shared/chatgptModels';
import type { ChatgptModelChoice, ChatgptModelState } from '../../../../shared/chatgptModels';
import { ProviderModelSubmenu, SubmenuSummaryText } from './ProviderModelSubmenu';
import type { ProviderSubmenuRowProps } from './ProviderModelSubmenu';

/** Reflected in the menu at once; main's answer — and its broadcast to every window — settles it. */
export function chooseChatgptModel(patch: Partial<ChatgptModelChoice>): void {
  const { chatgptModels, setChatgptModels } = useAppStore.getState();
  if (chatgptModels) setChatgptModels({ ...chatgptModels, choice: { ...chatgptModels.choice, ...patch } });
  void chatgptModelApi.set(patch).then(setChatgptModels);
}

/** The chosen version on a plan with a choice of them; nothing on a plan without (Free). */
export function chatgptSummaryText(state: ChatgptModelState | null): string | null {
  return selectedChatgptModel(state)?.label ?? null;
}

/** "GPT-5.6 Sol". The effort step and the thinking switch have their own control in the composer. */
export const ChatgptModelSummary: React.FC<{ state: ChatgptModelState }> = ({ state }) => (
  <SubmenuSummaryText text={chatgptSummaryText(state)} />
);

interface ChatgptModelSubmenuProps extends ProviderSubmenuRowProps {
  state: ChatgptModelState;
}

/** The ChatGPT row on a plan with versions (Plus), opening them. Picking one also picks ChatGPT. */
export const ChatgptModelSubmenu: React.FC<ChatgptModelSubmenuProps> = ({ state, ...row }) => {
  if (!state.catalog) return null;
  return (
    <ProviderModelSubmenu
      {...row}
      entries={state.catalog.models}
      selectedModelId={state.choice.modelId}
      summary={<ChatgptModelSummary state={state} />}
      onPickModel={(modelId) => chooseChatgptModel({ modelId })}
    />
  );
};
