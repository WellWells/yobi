import React, { useCallback, useEffect, useState } from 'react';
import { Box, Group, Loader, Text } from '@mantine/core';
import type { AgentRunState } from '../../../../shared/types';
import { agentApi } from '../../api/electronApi';
import { useAgentRunStore } from '../../store/useAgentRunStore';
import { runAsText, traceFromRun } from '../../utils/agentTrace';
import { AgentTraceRows } from '../AgentTraceRows';
import { CopyIconButton } from '../CopyIconButton';
import { TraceHeader } from './TraceHeader';

interface TurnTraceProps {
  runId: string;
  title: string;
  durationMs?: number;
  t: (key: string) => string;
}

type Loaded = { kind: 'run'; state: AgentRunState } | { kind: 'gone' };

/**
 * The reasoning behind one finished turn, closed unless the user expanded the live run.
 *
 * It is loaded on first open rather than with the conversation: a file of twenty turns would
 * otherwise read twenty run files to render rows nobody asked to see. `gone` is a normal
 * outcome, not an error — runs are reclaimed once stale, and the answer above stays readable
 * without its trace.
 */
function TurnTraceInner({ runId, title, durationMs, t }: TurnTraceProps) {
  const [liveView] = useState(() => useAgentRunStore.getState().runViews[runId]);
  const [open, setOpen] = useState(liveView?.open === true);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!open || loaded) return undefined;
    let current = true;
    void agentApi.getRun(runId)
      .then((state) => { if (current) setLoaded(state ? { kind: 'run', state } : { kind: 'gone' }); })
      .catch(() => { if (current) setLoaded({ kind: 'gone' }); });
    return () => { current = false; };
  }, [open, loaded, runId]);

  // Written back: the next mount, a resume's bubble and the run's other turn all read the store.
  const toggle = useCallback((): void => {
    setOpen(!open);
    useAgentRunStore.getState().setRunOpen(runId, !open);
  }, [open, runId]);

  // Rows expanded during the run stay on screen while the same rows load from the run file.
  const liveSteps = liveView?.ending?.steps.filter((row) => row.tool) ?? [];
  const steps = loaded?.kind === 'run' ? traceFromRun(loaded.state.turns) : loaded ? [] : liveSteps;
  const loading = !loaded && steps.length === 0;

  return (
    <Box mb={8}>
      <TraceHeader title={title} durationMs={durationMs} open={open} onToggle={toggle} />

      {open && (
        <Box mt={4}>
          {loading && (
            <Group gap={6} c="dimmed">
              <Loader size="xs" />
              <Text fz="var(--font-size-xs)">{t('chat.trace.loading')}</Text>
            </Group>
          )}
          {loaded?.kind === 'gone' && (
            <Text fz="var(--font-size-xs)" c="dimmed">{t('chat.trace.unavailable')}</Text>
          )}
          {loaded?.kind === 'run' && steps.length === 0 && (
            <Text fz="var(--font-size-xs)" c="dimmed">{t('chat.trace.empty')}</Text>
          )}
          {steps.length > 0 && <AgentTraceRows trace={steps} />}
          {loaded?.kind === 'run' && steps.length > 0 && (
            <Box mt={4}>
              <CopyIconButton
                value={runAsText(loaded.state)}
                copyLabel={t('chat.trace.copy')}
                copiedLabel={t('chat.copied')}
                size={22}
                position="bottom"
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export const TurnTrace = React.memo(TurnTraceInner);
