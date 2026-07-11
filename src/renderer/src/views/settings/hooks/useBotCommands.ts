import { useCallback, useEffect, useRef, useState } from 'react';
import { botApi, settingsApi } from '../../../api/electronApi';

import type { BotProviderCommand, DuckaiModelInfo, Provider } from '../../../../../shared/types';

// The AI provider slash commands both bots answer, plus the Duck.ai model list
// the '/duck' row picks from.
export function useBotCommands() {
  const [providerCommands, setProviderCommands] = useState<Record<Provider, BotProviderCommand> | null>(null);
  const [duckaiModels, setDuckaiModels] = useState<DuckaiModelInfo[]>([]);
  const [botCommandsBusy, setBotCommandsBusy] = useState(false);
  const providerCommandsRef = useRef<Record<Provider, BotProviderCommand> | null>(null);
  providerCommandsRef.current = providerCommands;

  const loadBotCommands = useCallback(async () => {
    setProviderCommands(await botApi.getProviderCommands());
  }, []);

  useEffect(() => {
    void loadBotCommands();
  }, [loadBotCommands]);

  useEffect(() => {
    void settingsApi.fetchDuckaiModels().then(setDuckaiModels).catch(() => setDuckaiModels([]));
  }, []);

  const handleUpdateProviderCommand = useCallback(async (provider: Provider, patch: Partial<BotProviderCommand>) => {
    const current = providerCommandsRef.current;
    if (!current) return;
    const next = { ...current, [provider]: { ...current[provider], ...patch } };
    setBotCommandsBusy(true);
    try {
      await botApi.updateProviderCommands(next);
      await loadBotCommands();
    } finally {
      setBotCommandsBusy(false);
    }
  }, [loadBotCommands]);

  return {
    providerCommands,
    duckaiModels,
    botCommandsBusy,
    loadBotCommands,
    handleUpdateProviderCommand,
  };
}
