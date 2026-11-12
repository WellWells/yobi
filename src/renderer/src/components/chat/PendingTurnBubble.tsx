import React, { useCallback, useMemo } from 'react';
import { Box, Group, Loader, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, type PendingTurn } from '../../store/appStore';
import { useAgentRunStore, type AgentTraceTurn } from '../../store/useAgentRunStore';
import { pendingHeader, pendingPhase, type PendingHeaderState } from '../../utils/agentTrace';
import { queueProgressForRun, queueWaitAhead } from '../../utils/queueProgress';
import { UserBubble } from './UserBubble';
import { ShellBubble } from './ShellBubble';
import { shellApi } from '../../api/electronApi';
import { StepProgressCard } from './StepProgressCard';
import { TraceHeader } from './TraceHeader';
import { AgentTraceRows } from '../AgentTraceRows';
import { FlowBuildProgressView } from '../FlowBuildProgress';
import { PROGRESS_ROW_STYLE, ProgressMark } from '../ProgressMark';
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
  return (trace ?? []).filter((turn) => turn.tool || turn.provider || turn.thought || turn.stage || turn.research || turn.helperSteps);
}

export function PlanRows({ steps, done }: { steps: readonly string[]; done: readonly number[] }) {
  return (
    <>
      {steps.map((step, index) => (
        <Box key={step} style={PROGRESS_ROW_STYLE}>
          <ProgressMark state={done.includes(index + 1) ? 'done' : 'pending'} />
          <Text component="span" fz="var(--font-size-xs)" c="dimmed" title={step} style={PLAN_TEXT_STYLE}>{step}</Text>
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
  const view = useAgentRunStore((state) => (runId ? state.runViews[runId] : undefined));
  const setRunOpen = useAgentRunStore((state) => state.setRunOpen);
  // A flow build inside this run draws its own five phases; the run id is the build id.
  const flowBuild = useFlowBuildStore(useShallow((state) => (runId ? state.builds[runId] : undefined)));

  // A view from before this send is the run's earlier attempt: its clock and title are over.
  const liveView = view && turn.beganAt !== undefined && view.startedAt >= turn.beganAt ? view : undefined;
  const ending = liveView?.ending;
  const steps = useMemo(() => visibleTraceSteps(ending?.steps ?? trace), [ending, trace]);
  const shownPlan = ending?.plan ?? plan;
  const hasPlan = Boolean(shownPlan && shownPlan.steps.length > 0);
  // Only what the user can read counts: a row still deciding its step adds nothing to the line.
  const hasDetail = hasPlan || Boolean(flowBuild) || steps.some((step) => step.tool);
  const open = liveView?.open === true;
  const toggleOpen = useCallback((): void => {
    if (runId) setRunOpen(runId, !open);
  }, [runId, open, setRunOpen]);

  const headerState: PendingHeaderState = {
    command: turn.command,
    waitAhead,
    synthesizing: ending?.synthesizing ?? synthesizing,
    // The run is parked on the user or re-reading what it just did — neither should read as "thinking".
    stage: ending ? ending.stage : trace?.at(-1)?.stage?.label,
    steps: liveView ? steps : [],
    title: liveView?.title,
    progress: liveView ? progress : undefined,
    build: flowBuild,
  };
  const header = pendingHeader(headerState, t);
  const phase = pendingPhase(headerState, t);

  const { shell, sendId } = turn;
  const stopShell = useCallback((): void => { void shellApi.stop(sendId); }, [sendId]);
  if (shell) {
    return (
      <Stack gap={20}>
        <ShellBubble
          command={shell.command}
          output={shell.output}
          shellLabel={shell.shellLabel}
          folder={shell.folder}
          exitCode={shell.exitCode}
          stopped={shell.stopped}
          running={shell.running}
          onStop={stopShell}
          t={t}
        />
        {!shell.running && !shell.stopped && (
          <Group gap={HEADER_GAP} c="dimmed">
            <Loader size={HEADER_LOADER} />
            <Text fz="var(--font-size-md)">{t('chat.thinking')}</Text>
          </Group>
        )}
      </Stack>
    );
  }

  const showDetail = liveView ? open && hasDetail : true;
  const inset = liveView ? 0 : INSET;

  return (
    <Stack gap={20}>
      <UserBubble prompt={turn.prompt} t={t} attachments={turn.attachments} attachmentFiles={turn.attachmentFiles} />
      <Stack gap={6}>
        {liveView ? (
          <TraceHeader
            title={header}
            phase={phase}
            running
            startedAt={liveView.startedAt}
            open={open}
            onToggle={hasDetail ? toggleOpen : undefined}
          />
        ) : turn.progress ? (
          <StepProgressCard progress={turn.progress} t={t} />
        ) : (
          <Group gap={HEADER_GAP} c="dimmed">
            <Loader size={HEADER_LOADER} />
            <Text fz="var(--font-size-md)">{header}</Text>
          </Group>
        )}
        {showDetail && shownPlan && hasPlan && (
          <Box pl={inset}>
            <Text fz="var(--font-size-xs)" fw={500} c="dimmed">{t('agent.trace.plan')}</Text>
            <PlanRows steps={shownPlan.steps} done={shownPlan.done} />
          </Box>
        )}
        {showDetail && flowBuild && (
          <Box pl={inset}>
            <FlowBuildProgressView state={flowBuild} />
          </Box>
        )}
        {showDetail && steps.length > 0 ? (
          <Box pl={inset}>
            <AgentTraceRows trace={steps} />
          </Box>
        ) : progress && !liveView ? (
          <Text pl={inset} fz="var(--font-size-sm)" c="dimmed">{progress}</Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

export const PendingTurnBubble = React.memo(PendingTurnBubbleInner);
