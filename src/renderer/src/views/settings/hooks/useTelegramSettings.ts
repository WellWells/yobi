import { useCallback, useEffect, useRef, useState } from 'react';
import { telegramApi, clipboardApi, settingsApi } from '../../../api/electronApi';

import type { DuckaiModelInfo, Provider, TelegramProviderCommand, TelegramSettingsSnapshot } from '../../../../../shared/types';

export function useTelegramSettings() {
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettingsSnapshot | null>(null);
  const [telegramTokenInput, setTelegramTokenInput] = useState('');
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [duckaiModels, setDuckaiModels] = useState<DuckaiModelInfo[]>([]);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const telegramSettingsRef = useRef<TelegramSettingsSnapshot | null>(null);
  telegramSettingsRef.current = telegramSettings;

  const loadTelegramSettings = useCallback(async () => {
    const snapshot = await telegramApi.getSettings();
    setTelegramSettings(snapshot);
  }, []);

  // Every mutating handler runs through this so telegramBusy always resets, even
  // when the IPC call rejects (otherwise a single failure freezes the controls).
  const runBusy = useCallback(async (action: () => Promise<void>) => {
    setTelegramBusy(true);
    try {
      await action();
    } finally {
      setTelegramBusy(false);
    }
  }, []);

  const refreshTelegramSettings = useCallback(async () => {
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }
    const task = loadTelegramSettings().finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = task;
    await task;
  }, [loadTelegramSettings]);

  useEffect(() => {
    void refreshTelegramSettings();
    const unsub = telegramApi.onRuntime((runtime) => {
      setTelegramSettings((prev) => {
        if (!prev) return prev;
        return { ...prev, runtime };
      });
      void refreshTelegramSettings();
    });
    return unsub;
  }, [refreshTelegramSettings]);

  useEffect(() => {
    void settingsApi.fetchDuckaiModels().then(setDuckaiModels).catch(() => setDuckaiModels([]));
  }, []);

  const handleUpdateProviderCommand = useCallback(async (provider: Provider, patch: Partial<TelegramProviderCommand>) => {
    const current = telegramSettingsRef.current?.providerCommands;
    if (!current) return;
    const next = { ...current, [provider]: { ...current[provider], ...patch } };
    await runBusy(async () => {
      await telegramApi.updateProviderCommands(next);
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleToggleTelegramEnabled = useCallback(async () => {
    const snapshot = telegramSettingsRef.current;
    if (!snapshot) return;
    await runBusy(async () => {
      await telegramApi.updateEnabled(!snapshot.enabled);
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleToggleTelegramGroupCommands = useCallback(async () => {
    const snapshot = telegramSettingsRef.current;
    if (!snapshot) return;
    await runBusy(async () => {
      await telegramApi.updateAllowGroupCommands(!snapshot.allowGroupCommands);
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleTelegramDefaultReplyMode = useCallback(async (mode: 'markdown' | 'png' | 'webp' | 'pdf') => {
    await runBusy(async () => {
      await telegramApi.updateDefaultReplyMode(mode);
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleSaveTelegramToken = useCallback(async () => {
    await runBusy(async () => {
      const result = await telegramApi.updateToken(telegramTokenInput);
      await loadTelegramSettings();
      if (result.ok) setTelegramTokenInput('');
    });
  }, [runBusy, telegramTokenInput, loadTelegramSettings]);

  const handleToggleTelegramAdmin = useCallback(async (userId: number) => {
    const snapshot = telegramSettingsRef.current;
    if (!snapshot) return;
    const next = new Set(snapshot.adminUserIds ?? []);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    await runBusy(async () => {
      await telegramApi.updateAdminUsers(Array.from(next));
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleGeneratePairingCode = useCallback(async () => {
    await runBusy(async () => {
      await telegramApi.generatePairingCode();
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleRevokePairingCode = useCallback(async (code: string) => {
    await runBusy(async () => {
      await telegramApi.revokePairingCode(code);
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  const handleCopyPairingCode = useCallback(async (code: string) => {
    await clipboardApi.copyText(code);
  }, []);

  const buildTelegramStartUrl = useCallback((code: string): string | null => {
    const rawUsername = telegramSettings?.runtime.botUsername ?? '';
    const username = rawUsername.replace(/^@/, '').trim();
    if (!username) return null;
    return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
  }, [telegramSettings?.runtime.botUsername]);

  const handleCopyTelegramStartUrl = useCallback(async (code: string) => {
    const url = buildTelegramStartUrl(code);
    if (!url) return;
    await clipboardApi.copyText(url);
  }, [buildTelegramStartUrl]);

  const handleOpenTelegramStart = useCallback(async (code: string) => {
    const url = buildTelegramStartUrl(code);
    if (!url) return;
    await clipboardApi.openExternalUrl(url);
  }, [buildTelegramStartUrl]);

  const handleUnpairTelegramUser = useCallback(async (userId: number) => {
    await runBusy(async () => {
      await telegramApi.unpairUser(userId);
      await loadTelegramSettings();
    });
  }, [runBusy, loadTelegramSettings]);

  return {
    telegramSettings,
    telegramTokenInput,
    setTelegramTokenInput,
    telegramBusy,
    duckaiModels,
    loadTelegramSettings,
    handleUpdateProviderCommand,
    handleToggleTelegramEnabled,
    handleToggleTelegramGroupCommands,
    handleTelegramDefaultReplyMode,
    handleSaveTelegramToken,
    handleToggleTelegramAdmin,
    handleGeneratePairingCode,
    handleRevokePairingCode,
    handleCopyPairingCode,
    handleCopyTelegramStartUrl,
    handleOpenTelegramStart,
    handleUnpairTelegramUser,
  };
}
