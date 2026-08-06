import { useCallback, useEffect, useRef, useState } from 'react';
import { botApi, settingsApi } from '../../../api/electronApi';

import { useAppStore } from '../../../store/appStore';

import type {
  BotBuiltinCommand,
  BotBuiltinCommandKey,
  BotBuiltinCommands,
  BotByokCommandInfo,
  BotProviderCommand,
  DuckaiModelInfo,
  Provider,
} from '../../../../../shared/types';

export function useBotCommands() {
  const [providerCommands, setProviderCommands] = useState<Record<Provider, BotProviderCommand> | null>(null);
  const [builtinCommands, setBuiltinCommands] = useState<BotBuiltinCommands | null>(null);
  const [byokCommands, setByokCommands] = useState<BotByokCommandInfo[]>([]);
  const [duckaiModels, setDuckaiModels] = useState<DuckaiModelInfo[]>([]);
  const [botCommandsBusy, setBotCommandsBusy] = useState(false);
  const providerCommandsRef = useRef<Record<Provider, BotProviderCommand> | null>(null);
  providerCommandsRef.current = providerCommands;
  const builtinCommandsRef = useRef<BotBuiltinCommands | null>(null);
  builtinCommandsRef.current = builtinCommands;

  const loadBotCommands = useCallback(async () => {
    const [providers, builtins, byok] = await Promise.all([
      botApi.getProviderCommands(),
      botApi.getBuiltinCommands(),
      botApi.getByokCommands(),
    ]);
    setProviderCommands(providers);
    setBuiltinCommands(builtins);
    setByokCommands(byok);
  }, []);

  // BYOK keys are added, renamed and deleted on this same page, and each edit can change
  // which command name a key ends up with — reload whenever that list moves.
  const byokSignature = useAppStore((s) =>
    [...s.byokModels, ...s.byokGroupModels].map((m) => m.url + '=' + m.label).join('|'));

  useEffect(() => {
    void loadBotCommands();
  }, [loadBotCommands, byokSignature]);

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

  const saveBuiltinCommands = useCallback(async (next: BotBuiltinCommands) => {
    setBotCommandsBusy(true);
    try {
      await botApi.updateBuiltinCommands(next);
      await loadBotCommands();
    } finally {
      setBotCommandsBusy(false);
    }
  }, [loadBotCommands]);

  const handleUpdateBuiltinCommand = useCallback(async (
    key: BotBuiltinCommandKey,
    patch: Partial<BotBuiltinCommand>,
  ) => {
    const current = builtinCommandsRef.current;
    if (!current) return;
    await saveBuiltinCommands({ ...current, [key]: { ...current[key], ...patch } });
  }, [saveBuiltinCommands]);

  const handleUpdateAskTtl = useCallback(async (minutes: number) => {
    const current = builtinCommandsRef.current;
    if (!current || current.askTtlMinutes === minutes) return;
    await saveBuiltinCommands({ ...current, askTtlMinutes: minutes });
  }, [saveBuiltinCommands]);

  const handleToggleByokCommand = useCallback(async (id: string, enabled: boolean) => {
    setBotCommandsBusy(true);
    try {
      await botApi.setByokCommandEnabled(id, enabled);
      await loadBotCommands();
    } finally {
      setBotCommandsBusy(false);
    }
  }, [loadBotCommands]);

  return {
    providerCommands,
    builtinCommands,
    byokCommands,
    duckaiModels,
    botCommandsBusy,
    loadBotCommands,
    handleUpdateProviderCommand,
    handleUpdateBuiltinCommand,
    handleUpdateAskTtl,
    handleToggleByokCommand,
  };
}
