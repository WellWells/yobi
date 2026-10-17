import React, { useMemo } from 'react';
import { Box, Group, Loader, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, type PendingTurn } from '../../store/appStore';
import { useAgentRunStore, type AgentTraceTurn } from '../../store/useAgentRunStore';
import { queueProgressForRun, queueWaitAhead } from '../../utils/queueProgress';
import { UserBubble } from './UserBubble';
import { StepProgressCard } from './StepProgressCard';
import { AgentTraceRows } from '../AgentTraceRows';
import { FlowBuildProgressView } from '../FlowBuildProgress';
import { NUMBERED_MARK_OFFSET, PROGRESS_ROW_STYLE, ProgressMark, StepNumber } from '../ProgressMark';
import { useFlowBuildStore } from '../../store/useFlowBuildStore';

const HEADER_LOADER = 18;
const HEADER_GAP = 8;
const INSET = HEADER_LOADER + HEADER_GAP;

const PLAN_TEXT_STYLE = { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

interface PendingTurnBubbleProps {
  turn: PendingTurn;
  t: (key: string) => string;
}

export function visibleTraceSteps(trace: AgentTraceTurn[] | undefined): AgentTraceTurn[] {
  return (trace ?? []).filter((turn) => turn.tool || turn.provider || turn.thought || turn.stage || turn.research);
}

export function PlanRows({ steps, done }: { steps: readonly string[]; done: readonly number[] }) {
  return (
    <>
      {steps.map((step, index) => (
        <Box key={step} style={PROGRESS_ROW_STYLE}>
          <StepNumber value={index + 1} />
          <ProgressMark state={done.includes(index + 1) ? 'done' : 'pending'} />
          <Text component="span" fz="var(--font-size-xs)" c="dimmed" style={PLAN_TEXT_STYLE}>{step}</Text>
        </Box>
      ))}
    </>
  );
}

function PendingTurnBubbleInner({ turn, t }: PendingTurnBubbleProps) {
  const runId = turn.runId;
  const progress = useAppStore((state) => queueProgressForRun(state.queue.items, runId));
  const waitAhead = useAppStore((state) => queueWaitAhead(state.queue.items, runId));
  const trace = useAgentRunStore(useShallow((state) => (runId ? state.traces[runId] : undefined)));
  const plan = useAgentRunStore(useShallow((state) => (runId ? state.plans[runId] : undefined)));
  const synthesizing = useAgentRunStore((state) => (runId ? Boolean(state.synthesizing[runId]) : false));
  // A flow build inside this run draws its own five phases; the run id is the build id.
  const flowBuild = useFlowBuildStore(useShallow((state) => (runId ? state.builds[runId] : undefined)));

  const steps = useMemo(() => visibleTraceSteps(trace), [trace]);
  // The run is parked on the user or re-reading what it just did — neither should read as "thinking".
  const latestStage = trace && trace.length > 0 ? trace[trace.length - 1].stage?.label : undefined;

  const header = turn.command
    ? t('chat.command.running')
    : waitAhead >= 0
    ? t('agent.queue.waiting').replace('{{count}}', String(waitAhead))
    : synthesizing
      ? t('agent.stage.answering')
      : latestStage === 'confirming'
        ? t('agent.pending.confirming')
        : latestStage === 'verifying'
          ? t('agent.pending.verifying')
          : t('chat.thinking');

  return (
    <Stack gap={20}>
      <UserBubble prompt={turn.prompt} t={t} attachments={turn.attachments} />
      <Stack gap={6}>
        {turn.progress ? (
          <StepProgressCard progress={turn.progress} t={t} />
        ) : (
          <Group gap={HEADER_GAP} c="dimmed">
            <Loader size={HEADER_LOADER} />
            <Text fz="var(--font-size-md)">{header}</Text>
          </Group>
        )}
        {plan && plan.steps.length > 0 && (
          <Box pl={INSET}>
            <Text fz="var(--font-size-xs)" fw={500} c="dimmed">{t('agent.trace.plan')}</Text>
            <PlanRows steps={plan.steps} done={plan.done} />
          </Box>
        )}
        {flowBuild && (
          <Box pl={INSET + NUMBERED_MARK_OFFSET}>
            <FlowBuildProgressView state={flowBuild} />
          </Box>
        )}
        {steps.length > 0 ? (
          <Box pl={INSET}>
            <AgentTraceRows trace={steps} />
          </Box>
        ) : progress ? (
          <Text pl={INSET} fz="var(--font-size-sm)" c="dimmed">{progress}</Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

export const PendingTurnBubble = React.memo(PendingTurnBubbleInner);
