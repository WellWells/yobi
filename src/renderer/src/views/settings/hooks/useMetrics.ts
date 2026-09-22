import { useCallback, useEffect, useState } from 'react';
import { byokApi, flowMetricsApi, ipcEvents, metricsApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import type { ByokInstanceSnapshot, MetricsSnapshot } from '../../../../../shared/types';
import type { FlowMetricsSnapshot } from '../../../../../shared/flowMetrics';
import type { ConversationTokenStats } from '../../../../../shared/tokenEstimate';

export function useMetrics() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [flowSnapshot, setFlowSnapshot] = useState<FlowMetricsSnapshot | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [conversationTokens, setConversationTokens] = useState<ConversationTokenStats | null>(null);
  const [byokInstances, setByokInstances] = useState<ByokInstanceSnapshot[]>([]);
  const settingsVisible = useAppStore((state) => state.currentView === 'settings');

  useEffect(() => {
    void metricsApi.getEnabled().then(setEnabled);
  }, []);

  /**
   * Both snapshots, only while the page is open. Counters flush per flow step and per model
   * call rather than per run, so a busy loop or an `/agent` run broadcasts repeatedly — and
   * every view stays mounted, so an ungated subscription would re-render settings that nobody
   * is looking at for the length of the run. `useMetrics` is called by `SettingsView` itself,
   * so that re-render is the whole page, not just the statistics section.
   */
  useEffect(() => {
    if (!settingsVisible) return;
    void metricsApi.get().then(setSnapshot);
    return ipcEvents.onMetricsChanged(setSnapshot);
  }, [settingsVisible]);

  useEffect(() => {
    if (!settingsVisible) return;
    void flowMetricsApi.get().then(setFlowSnapshot).catch(() => {});
    return ipcEvents.onFlowMetricsChanged(setFlowSnapshot);
  }, [settingsVisible]);

  useEffect(() => {
    if (!settingsVisible) return;
    void metricsApi.getConversationTokens().then(setConversationTokens).catch(() => {});
  }, [settingsVisible, snapshot]);

  // Key counters are stored by id; names come from the live BYOK list, so a deleted key
  // simply stops being listed instead of lingering under a remembered name.
  useEffect(() => {
    if (!settingsVisible) return;
    void byokApi.getSettings().then((s) => setByokInstances(s.instances)).catch(() => {});
  }, [settingsVisible]);

  const handleToggleEnabled = useCallback(async () => {
    const next = !enabled;
    await metricsApi.updateEnabled(next);
    setEnabled(next);
  }, [enabled]);

  const handleReset = useCallback(async () => {
    const next = await metricsApi.reset();
    setSnapshot(next);
    void flowMetricsApi.get().then(setFlowSnapshot).catch(() => {});
  }, []);

  const applyMetricsReset = useCallback((enabledValue: boolean) => {
    setEnabled(enabledValue);
    void metricsApi.get().then(setSnapshot);
    void flowMetricsApi.get().then(setFlowSnapshot).catch(() => {});
  }, []);

  return {
    snapshot,
    flowSnapshot,
    enabled,
    conversationTokens,
    byokInstances,
    handleToggleEnabled,
    handleReset,
    applyMetricsReset,
  };
}
