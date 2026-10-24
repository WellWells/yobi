import { useCallback, useEffect, useRef, useState } from 'react';
import { socketBotApi } from '../../../api/electronApi';
import type {
  BotLlmDirectConfig,
  SocketBotActionResult,
  SocketBotPlatform,
  SocketBotSecretField,
  SocketBotSettingsSnapshot,
} from '../../../../../shared/types';

/**
 * One socket platform's settings (Discord or Slack): its snapshot, kept current by the runtime
 * broadcast for that platform, the secret fields being typed, and every change the card makes.
 */
export function useSocketBotSettings(platform: SocketBotPlatform) {
  const [settings, setSettings] = useState<SocketBotSettingsSnapshot | null>(null);
  const [secretInputs, setSecretInputs] = useState<Partial<Record<SocketBotSecretField, string>>>({});
  const [busy, setBusy] = useState(false);
  const settingsRef = useRef<SocketBotSettingsSnapshot | null>(null);
  settingsRef.current = settings;

  const load = useCallback(async () => {
    const snapshot = await socketBotApi.getSettings(platform);
    if (snapshot) setSettings(snapshot);
  }, [platform]);

  useEffect(() => {
    void load();
    return socketBotApi.onRuntime((runtime) => {
      if (runtime.platform !== platform) return;
      setSettings((prev) => (prev ? { ...prev, runtime } : prev));
      void load();
    });
  }, [platform, load]);

  /** Runs one change with the card busy; the snapshot it answers with replaces the shown one. */
  const run = useCallback(async (action: () => Promise<SocketBotActionResult>): Promise<SocketBotActionResult> => {
    setBusy(true);
    try {
      const result = await action();
      if (result.snapshot) setSettings(result.snapshot);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleEnabled = useCallback(async () => {
    const current = settingsRef.current;
    if (!current) return;
    await run(() => socketBotApi.updateEnabled(platform, !current.enabled));
  }, [platform, run]);

  const setSecretInput = useCallback((field: SocketBotSecretField, value: string) => {
    setSecretInputs((prev) => ({ ...prev, [field]: value }));
  }, []);

  const saveSecrets = useCallback(async () => {
    const typed = Object.fromEntries(Object.entries(secretInputs).filter(([, value]) => value?.trim())) as Record<string, string>;
    const result = await run(() => socketBotApi.updateSecrets(platform, typed));
    // Cleared whether or not the bot connected: the error says why, and the saved secret is masked above.
    setSecretInputs({});
    return result;
  }, [platform, secretInputs, run]);

  const updateLlmDirect = useCallback(async (patch: Partial<BotLlmDirectConfig>) => {
    const current = settingsRef.current?.llmDirect;
    if (!current) return;
    await run(() => socketBotApi.updateLlmDirect(platform, { ...current, ...patch }));
  }, [platform, run]);

  const generatePairingCode = useCallback(() => run(() => socketBotApi.generatePairingCode(platform)), [platform, run]);
  const revokePairingCode = useCallback((code: string) => run(() => socketBotApi.revokePairingCode(platform, code)), [platform, run]);
  const unpairUser = useCallback((userId: string) => run(() => socketBotApi.unpairUser(platform, userId)), [platform, run]);
  const reconnect = useCallback(() => run(() => socketBotApi.reconnect(platform)), [platform, run]);

  return {
    platform,
    settings,
    secretInputs,
    setSecretInput,
    busy,
    load,
    toggleEnabled,
    saveSecrets,
    updateLlmDirect,
    generatePairingCode,
    revokePairingCode,
    unpairUser,
    reconnect,
  };
}

export type SocketBotSettingsControls = ReturnType<typeof useSocketBotSettings>;
