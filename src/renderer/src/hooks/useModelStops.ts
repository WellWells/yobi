import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { visibleModels } from '../config/models';
import {
  buildModelStops,
  currentStopIndex,
  stopKey,
  type ModelStop,
  type ModelStopSources,
} from '../config/modelStops';
import { selectHiddenSources, useAppStore } from '../store/appStore';
import { loginRequiredProviderForUrl } from '../../../shared/types';
import { chooseGeminiModel } from '../components/chat/GeminiModelMenu';
import { chooseClaudeModel } from '../components/chat/ClaudeModelMenu';
import { chooseChatgptModel } from '../components/chat/ChatgptModelMenu';

type AppStoreState = ReturnType<typeof useAppStore.getState>;

function stopSources(
  state: Pick<AppStoreState, 'byokModels' | 'byokGroupModels' | 'geminiModels' | 'claudeModels' | 'chatgptModels' | 'accountStatuses'>,
  hidden: ReturnType<typeof selectHiddenSources>,
): ModelStopSources {
  return {
    models: visibleModels(state, hidden),
    geminiModels: state.geminiModels,
    claudeModels: state.claudeModels,
    chatgptModels: state.chatgptModels,
    needsLogin: (url) => {
      const provider = loginRequiredProviderForUrl(url);
      return provider !== null && state.accountStatuses[provider] === false;
    },
  };
}

/** For event handlers: the list as it stands right now, without subscribing. */
export function modelStopSources(state: AppStoreState): ModelStopSources {
  return stopSources(state, selectHiddenSources(state));
}

/**
 * Makes a stop's model the provider's pick, exactly as its row in the model menu does. The
 * provider itself is switched by the caller, which owns the login prompt.
 */
export function chooseModelStop(stop: ModelStop): void {
  if (!stop.sub) return;
  const { geminiModels, claudeModels, chatgptModels } = useAppStore.getState();
  const { id } = stop.sub;
  switch (stop.sub.provider) {
    case 'gemini':
      if (geminiModels?.choice.modelId !== id) chooseGeminiModel({ modelId: id });
      return;
    case 'claude':
      if (claudeModels?.choice.modelId !== id) chooseClaudeModel({ modelId: id });
      return;
    case 'chatgpt':
      if (chatgptModels?.choice.modelId !== id) chooseChatgptModel({ modelId: id });
      return;
  }
}

export interface ModelStops {
  stops: ModelStop[];
  /** `stopKey` of the one the chat is on, or `null` when it is on none of them. */
  currentKey: string | null;
}

export function useModelStops(activeUrl: string): ModelStops {
  const state = useAppStore(useShallow((s) => ({
    byokModels: s.byokModels,
    byokGroupModels: s.byokGroupModels,
    geminiModels: s.geminiModels,
    claudeModels: s.claudeModels,
    chatgptModels: s.chatgptModels,
    accountStatuses: s.accountStatuses,
  })));
  const hidden = useAppStore(useShallow(selectHiddenSources));

  return useMemo(() => {
    const sources = stopSources(state, hidden);
    const stops = buildModelStops(sources);
    const index = currentStopIndex(stops, activeUrl, sources);
    return { stops, currentKey: index === -1 ? null : stopKey(stops[index]) };
  }, [state, hidden, activeUrl]);
}
