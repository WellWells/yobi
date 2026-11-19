import { useCallback, useEffect, useMemo, useState } from 'react';
import { byokApi, flowMetricsApi, ipcEvents, metricsApi } from '../../../api/electronApi';
import { usePageOnScreen } from '../FreezeWhileHidden';
import type { ByokInstanceSnapshot, MetricsSnapshot } from '../../../../../shared/types';
import type { FlowMetricsSnapshot } from '../../../../../shared/flowMetrics';
import type { ConversationTokenStats } from '../../../../../shared/tokenEstimate';

interface MetricsData {
  snapshot: MetricsSnapshot | null;
  flowSnapshot: FlowMetricsSnapshot | null;
  enabled: boolean;
  conversationTokens: ConversationTokenStats | null;
  byokInstances: ByokInstanceSnapshot[];
}

const EMPTY: MetricsData = { snapshot: null, flowSnapshot: null, enabled: true, conversationTokens: null, byokInstances: [] };

/** Resolves to undefined on failure: a part that cannot be read keeps what it had. */
function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  return promise.catch(() => undefined);
}

/**
 * The stats page's counters, held by the page itself (`LiveStatsSection`) and read only while it
 * is on screen, afresh each time it shows (a backup restore included). Held by SettingsView and
 * read on every opening of Settings, each answer redrew the page on screen; read on every opening
 * by the page itself, each answer redrew the hidden stats page in full. Counters also broadcast
 * per step and per model call: subscribed while hidden, the page would redraw throughout every run.
 *
 * The five reads land together, in one state: one at a time, the page drew five times over as it
 * came into view. The returned object only changes with them, so the page skips other redraws.
 */
export function useMetrics() {
  const [data, setData] = useState<MetricsData>(EMPTY);
  const onScreen = usePageOnScreen();

  useEffect(() => {
    if (!onScreen) return undefined;
    let live = true;
    const merge = (part: Partial<MetricsData>) => {
      if (live) setData((prev) => ({ ...prev, ...part }));
    };
    // Key counters are stored by id; names come from the live BYOK list, so a deleted key
    // simply stops being listed instead of lingering under a remembered name.
    void Promise.all([
      settle(metricsApi.getEnabled()),
      settle(metricsApi.get()),
      settle(flowMetricsApi.get()),
      settle(metricsApi.getConversationTokens()),
      settle(byokApi.getSettings()),
    ]).then(([enabled, snapshot, flowSnapshot, conversationTokens, byok]) => {
      const part: Partial<MetricsData> = {};
      if (enabled !== undefined) part.enabled = enabled;
      if (snapshot !== undefined) part.snapshot = snapshot;
      if (flowSnapshot !== undefined) part.flowSnapshot = flowSnapshot;
      if (conversationTokens !== undefined) part.conversationTokens = conversationTokens;
      if (byok !== undefined) part.byokInstances = byok.instances;
      merge(part);
    });
    const offMetrics = ipcEvents.onMetricsChanged((snapshot) => {
      merge({ snapshot });
      void settle(metricsApi.getConversationTokens()).then((conversationTokens) => {
        if (conversationTokens !== undefined) merge({ conversationTokens });
      });
    });
    const offFlow = ipcEvents.onFlowMetricsChanged((flowSnapshot) => merge({ flowSnapshot }));
    return () => {
      live = false;
      offMetrics();
      offFlow();
    };
  }, [onScreen]);

  const { enabled } = data;
  const handleToggleEnabled = useCallback(async () => {
    const next = !enabled;
    await metricsApi.updateEnabled(next);
    setData((prev) => ({ ...prev, enabled: next }));
  }, [enabled]);

  const handleReset = useCallback(async () => {
    const snapshot = await metricsApi.reset();
    const flowSnapshot = await settle(flowMetricsApi.get());
    setData((prev) => ({ ...prev, snapshot, ...(flowSnapshot !== undefined ? { flowSnapshot } : {}) }));
  }, []);

  return useMemo(() => ({ ...data, handleToggleEnabled, handleReset }), [data, handleToggleEnabled, handleReset]);
}
