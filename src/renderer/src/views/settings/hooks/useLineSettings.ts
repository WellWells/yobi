import { useCallback, useEffect, useRef, useState } from 'react';
import { lineApi } from '../../../api/electronApi';

import type { BotLlmDirectConfig, LineSettingsSnapshot } from '../../../../../shared/types';

export function useLineSettings() {
  const [lineSettings, setLineSettings] = useState<LineSettingsSnapshot | null>(null);
  const [lineTokenInput, setLineTokenInput] = useState('');
  const [lineSecretInput, setLineSecretInput] = useState('');
  const [lineBusy, setLineBusy] = useState(false);
  // The account re-check is the only LINE action that waits on the network, so
  // it gets its own flag and is the only button that shows a spinner.
  const [lineAccountBusy, setLineAccountBusy] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lineSettingsRef = useRef<LineSettingsSnapshot | null>(null);
  lineSettingsRef.current = lineSettings;

  const loadLineSettings = useCallback(async () => {
    const snapshot = await lineApi.getSettings();
    setLineSettings(snapshot);
  }, []);

  // Every mutating handler runs through this so lineBusy always resets, even when
  // the IPC call rejects (otherwise a single failure freezes the controls).
  const runBusy = useCallback(async (action: () => Promise<void>) => {
    setLineBusy(true);
    try {
      await action();
    } finally {
      setLineBusy(false);
    }
  }, []);

  const refreshLineSettings = useCallback(async () => {
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }
    const task = loadLineSettings().finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = task;
    await task;
  }, [loadLineSettings]);

  useEffect(() => {
    void refreshLineSettings();
    const unsub = lineApi.onRuntime((runtime) => {
      setLineSettings((prev) => (prev ? { ...prev, runtime } : prev));
      void refreshLineSettings();
    });
    return unsub;
  }, [refreshLineSettings]);

  const handleToggleLineEnabled = useCallback(async () => {
    const snapshot = lineSettingsRef.current;
    if (!snapshot) return;
    await runBusy(async () => {
      await lineApi.updateEnabled(!snapshot.enabled);
      await loadLineSettings();
    });
  }, [runBusy, loadLineSettings]);

  const handleSaveLineCredentials = useCallback(async () => {
    await runBusy(async () => {
      const result = await lineApi.updateCredentials({
        channelAccessToken: lineTokenInput,
        channelSecret: lineSecretInput,
      });
      await loadLineSettings();
      if (result.ok) {
        setLineTokenInput('');
        setLineSecretInput('');
      }
    });
  }, [runBusy, lineTokenInput, lineSecretInput, loadLineSettings]);

  const handleUpdateLinePort = useCallback(async (port: number) => {
    await runBusy(async () => {
      await lineApi.updatePort(port);
      await loadLineSettings();
    });
  }, [runBusy, loadLineSettings]);

  const handleUpdateLineLlmDirect = useCallback(async (patch: Partial<BotLlmDirectConfig>) => {
    const current = lineSettingsRef.current?.llmDirect;
    if (!current) return;
    await runBusy(async () => {
      const result = await lineApi.updateLlmDirect({ ...current, ...patch });
      setLineSettings(result.snapshot);
    });
  }, [runBusy]);

  const handleGenerateLinePairingCode = useCallback(async () => {
    await runBusy(async () => {
      const result = await lineApi.generatePairingCode();
      setLineSettings(result.snapshot);
    });
  }, [runBusy]);

  const handleRevokeLinePairingCode = useCallback(async (code: string) => {
    await runBusy(async () => {
      const result = await lineApi.revokePairingCode(code);
      setLineSettings(result.snapshot);
    });
  }, [runBusy]);

  const handleUnpairLineUser = useCallback(async (userId: string) => {
    await runBusy(async () => {
      const result = await lineApi.unpairUser(userId);
      setLineSettings(result.snapshot);
    });
  }, [runBusy]);

  // The refreshed account arrives through the LINE_RUNTIME broadcast, which the
  // effect above already turns into a settings reload.
  const handleRefreshLineAccount = useCallback(async () => {
    setLineAccountBusy(true);
    try {
      await lineApi.refreshAccount();
    } finally {
      setLineAccountBusy(false);
    }
  }, []);

  return {
    lineSettings,
    lineTokenInput,
    setLineTokenInput,
    lineSecretInput,
    setLineSecretInput,
    lineBusy,
    lineAccountBusy,
    loadLineSettings,
    handleToggleLineEnabled,
    handleSaveLineCredentials,
    handleUpdateLinePort,
    handleUpdateLineLlmDirect,
    handleGenerateLinePairingCode,
    handleRevokeLinePairingCode,
    handleUnpairLineUser,
    handleRefreshLineAccount,
  };
}
