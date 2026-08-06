import { useCallback, useEffect, useState } from 'react';
import { ipcEvents, metricsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import type { MetricsSnapshot } from '../../../../../shared/types';
import type { ConversationTokenStats } from '../../../../../shared/tokenEstimate';

export function useMetrics() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [conversationTokens, setConversationTokens] = useState<ConversationTokenStats | null>(null);
  const settingsVisible = useAppStore((state) => state.currentView === 'settings');

  useEffect(() => {
    void metricsApi.get().then(setSnapshot);
    void metricsApi.getEnabled().then(setEnabled);
    return ipcEvents.onMetricsChanged(setSnapshot);
  }, []);

  useEffect(() => {
    if (!settingsVisible) return;
    void metricsApi.getConversationTokens().then(setConversationTokens).catch(() => {});
  }, [settingsVisible, snapshot]);

  const handleToggleEnabled = useCallback(async () => {
    const next = !enabled;
    await metricsApi.updateEnabled(next);
    setEnabled(next);
  }, [enabled]);

  const handleReset = useCallback(async () => {
    const next = await metricsApi.reset();
    setSnapshot(next);
  }, []);

  const applyMetricsReset = useCallback((enabledValue: boolean) => {
    setEnabled(enabledValue);
    void metricsApi.get().then(setSnapshot);
  }, []);

  return { snapshot, enabled, conversationTokens, handleToggleEnabled, handleReset, applyMetricsReset };
}
