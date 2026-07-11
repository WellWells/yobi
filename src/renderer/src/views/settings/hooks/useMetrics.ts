import { useCallback, useEffect, useState } from 'react';
import { ipcEvents, metricsApi } from '../../../api/electronApi';
import type { MetricsSnapshot } from '../../../../../shared/types';

export function useMetrics() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    void metricsApi.get().then(setSnapshot);
    void metricsApi.getEnabled().then(setEnabled);
    return ipcEvents.onMetricsChanged(setSnapshot);
  }, []);

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

  return { snapshot, enabled, handleToggleEnabled, handleReset, applyMetricsReset };
}
