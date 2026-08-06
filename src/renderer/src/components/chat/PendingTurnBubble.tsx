import React, { useMemo } from 'react';
import { Box, Group, Loader, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, type PendingTurn } from '../../store/appStore';
import { useAgentRunStore, type AgentTraceTurn } from '../../store/useAgentRunStore';
import { queueProgressForRun, queueWaitAhead } from '../../utils/queueProgress';
import { UserBubble } from './UserBubble';
import { AgentTraceRows } from '../AgentTraceRows';

interface PendingTurnBubbleProps {
  turn: PendingTurn;
  t: (key: string) => string;
}

/**
 * A row earns its place once it can say more than the bubble header already does. A turn that
 * has only just started has none of tool / provider / thought / stage, and rendering it would
 * repeat "thinking" directly under the word "thinking".
 */
export function visibleTraceSteps(trace: AgentTraceTurn[] | undefined): AgentTraceTurn[] {
  return (trace ?? []).filter((turn) => turn.tool || turn.provider || turn.thought || turn.stage);
}

function PendingTurnBubbleInner({ turn, t }: PendingTurnBubbleProps) {
  const runId = turn.runId;
  const progress = useAppStore((state) => queueProgressForRun(state.queue.items, runId));
  // Serial queue: with a few cron flows enabled a run can sit untouched for minutes, and
  // "thinking" made that indistinguishable from a hang.
  const waitAhead = useAppStore((state) => queueWaitAhead(state.queue.items, runId));
  const trace = useAgentRunStore(useShallow((state) => (runId ? state.traces[runId] : undefined)));
  const plan = useAgentRunStore(useShallow((state) => (runId ? state.plans[runId] : undefined)));
  // The final write-up is the run's longest single call and the one phase with no row of its
  // own, so the header carries it — otherwise the UI reads as "still thinking" for a minute.
  const synthesizing = useAgentRunStore((state) => (runId ? Boolean(state.synthesizing[runId]) : false));

  const steps = useMemo(() => visibleTraceSteps(trace), [trace]);

  const header = waitAhead >= 0
    ? t('agent.queue.waiting').replace('{{count}}', String(waitAhead))
    : synthesizing
      ? t('agent.stage.answering')
      : t('chat.thinking');

  return (
    <Stack gap={20}>
      <UserBubble prompt={turn.prompt} t={t} />
      <Stack gap={6}>
        <Group gap={8} c="dimmed">
          <Loader size="xs" />
          <Text fz="var(--font-size-md)">{header}</Text>
        </Group>
        {plan && plan.steps.length > 0 && (
          <Box pl={24}>
            <Text fz="var(--font-size-xs)" fw={500} c="dimmed">{t('agent.trace.plan')}</Text>
            {plan.steps.map((step, index) => (
              <Text key={step} fz="var(--font-size-xs)" c="dimmed" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {`${plan.done.includes(index + 1) ? '✓' : '○'} ${index + 1}. ${step}`}
              </Text>
            ))}
          </Box>
        )}
        {steps.length > 0 ? (
          <Box pl={24}>
            <AgentTraceRows trace={steps} />
          </Box>
        ) : progress ? (
          <Text pl={24} fz="var(--font-size-sm)" c="dimmed">{progress}</Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

export const PendingTurnBubble = React.memo(PendingTurnBubbleInner);
