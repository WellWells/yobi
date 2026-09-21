import React, { useCallback, useState } from 'react';
import { Box, Group, Loader, Text, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentRunState } from '../../../../shared/types';
import { agentApi } from '../../api/electronApi';
import { runAsText, traceFromRun } from '../../utils/agentTrace';
import { AgentTraceRows } from '../AgentTraceRows';
import { CopyIconButton } from '../CopyIconButton';

interface TurnTraceProps {
  runId: string;
  t: (key: string) => string;
}

type Loaded = { kind: 'run'; state: AgentRunState } | { kind: 'gone' };

/**
 * The reasoning behind one finished turn, closed by default.
 *
 * It is loaded on first open rather than with the conversation: a file of twenty turns would
 * otherwise read twenty run files to render rows nobody asked to see. `gone` is a normal
 * outcome, not an error — runs are reclaimed once stale, and the answer above stays readable
 * without its trace.
 */
function TurnTraceInner({ runId, t }: TurnTraceProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback((): void => {
    setOpen((prev) => {
      const next = !prev;
      if (!next || loaded || loading) return next;
      setLoading(true);
      void agentApi.getRun(runId)
        .then((state) => setLoaded(state ? { kind: 'run', state } : { kind: 'gone' }))
        .catch(() => setLoaded({ kind: 'gone' }))
        .finally(() => setLoading(false));
      return next;
    });
  }, [runId, loaded, loading]);

  const steps = loaded?.kind === 'run' ? traceFromRun(loaded.state.turns) : [];

  return (
    <Box mt={6}>
      <UnstyledButton
        onClick={toggle}
        c="dimmed"
        aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Text fz="var(--font-size-sm)" fw={500}>{t('chat.trace.toggle')}</Text>
      </UnstyledButton>

      {open && (
        <Box pl={17} mt={4}>
          {loading && (
            <Group gap={6} c="dimmed">
              <Loader size="xs" />
              <Text fz="var(--font-size-xs)">{t('chat.trace.loading')}</Text>
            </Group>
          )}
          {!loading && loaded?.kind === 'gone' && (
            <Text fz="var(--font-size-xs)" c="dimmed">{t('chat.trace.unavailable')}</Text>
          )}
          {!loading && loaded?.kind === 'run' && (
            steps.length === 0 ? (
              <Text fz="var(--font-size-xs)" c="dimmed">{t('chat.trace.empty')}</Text>
            ) : (
              <>
                <AgentTraceRows trace={steps} />
                <Box mt={4}>
                  <CopyIconButton
                    value={runAsText(loaded.state)}
                    copyLabel={t('chat.trace.copy')}
                    copiedLabel={t('chat.copied')}
                    size={22}
                    position="bottom"
                  />
                </Box>
              </>
            )
          )}
        </Box>
      )}
    </Box>
  );
}

export const TurnTrace = React.memo(TurnTraceInner);
