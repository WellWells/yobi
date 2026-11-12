import { useEffect, useMemo, useState } from 'react';
import { flowApi, flowMetricsApi, ipcEvents } from '../../api/electronApi';
import { useFlowStore } from '../../store/useFlowStore';
import { lastRunsOf, type FlowLastRun, type FlowMetricsSnapshot } from '../../../../shared/flowMetrics';
import type { FlowDefinition, TriggerConfig } from '../../../../shared/types';

/** Asked again a little after the soonest run is due, so the row moves on to the one after it. */
const AFTER_DUE_MS = 5_000;
/** A timer longer than ~24.8 days overflows and fires at once; a far-off run is re-asked well before. */
const MAX_WAIT_MS = 6 * 60 * 60_000;

/** Each flow's latest run, from the flow statistics; follows them as they flush. */
export function useFlowLastRuns(): Record<string, FlowLastRun> {
  const [runs, setRuns] = useState<Record<string, FlowLastRun>>({});
  useEffect(() => {
    let alive = true;
    const take = (snapshot: FlowMetricsSnapshot): void => {
      if (!alive) return;
      const next = lastRunsOf(snapshot);
      // A flush that changed only step counters must not redraw every row.
      setRuns((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    void flowMetricsApi.get().then(take).catch(() => {});
    const off = ipcEvents.onFlowMetricsChanged(take);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return runs;
}

function scheduleTriggers(flow: FlowDefinition): TriggerConfig[] {
  return [flow.trigger, ...(flow.extraTriggers ?? [])].filter((trigger) => trigger.type === 'cron');
}

async function soonestRun(triggers: TriggerConfig[]): Promise<number | null> {
  const previews = await Promise.all(triggers.map((trigger) => flowApi.previewSchedule(trigger).catch(() => null)));
  const times = previews
    .flatMap((preview) => preview?.runs.slice(0, 1) ?? [])
    .map((iso) => new Date(iso).getTime())
    .filter(Number.isFinite);
  return times.length > 0 ? Math.min(...times) : null;
}

/**
 * The next run of every saved, enabled flow with a schedule, asked of the scheduler that runs it.
 * The saved copy, not the editor's: an unsaved schedule is not what will run.
 */
export function useFlowNextRuns(): Record<string, Date> {
  const savedFlows = useFlowStore((s) => s.savedFlows);
  const plan = useMemo(() => JSON.stringify(
    Object.values(savedFlows)
      .filter((flow) => flow.enabled)
      .map((flow) => [flow.id, scheduleTriggers(flow)] as const)
      .filter(([, triggers]) => triggers.length > 0),
  ), [savedFlows]);
  const [next, setNext] = useState<Record<string, Date>>({});
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const entries = JSON.parse(plan) as [string, TriggerConfig[]][];
    void Promise.all(entries.map(async ([id, triggers]) => [id, await soonestRun(triggers)] as const))
      .then((results) => {
        if (!alive) return;
        const found: Record<string, Date> = {};
        for (const [id, at] of results) if (at !== null) found[id] = new Date(at);
        setNext(found);
        const soonest = Math.min(...Object.values(found).map((date) => date.getTime()));
        if (!Number.isFinite(soonest)) return;
        const wait = Math.min(Math.max(0, soonest - Date.now()) + AFTER_DUE_MS, MAX_WAIT_MS);
        timer = setTimeout(() => setRound((n) => n + 1), wait);
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [plan, round]);

  return next;
}
