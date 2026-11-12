import React, { useDeferredValue, useEffect, useMemo } from 'react';
import { Box, Overlay, Stack } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import type { ProgressState } from '../../../components/ProgressMark';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { useFlowAssistStore, type OutlineTab } from '../../../store/useFlowAssistStore';
import { useFlowOutlineStore } from '../../../store/useFlowOutlineStore';
import { useFlowStore } from '../../../store/useFlowStore';
import { BACKDROP_OPACITY } from '../../../theme/mantineTheme';
import { isMac } from '../../../utils/keyLabels';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { FlowDefinition } from '../../../../../shared/types';
import { stepMark } from '../ExecutionResultPanel';
import { triggerFact } from '../flowHomeModel';
import { RUN_SPOT_LABEL_KEY, runSpot, stepLogsById } from '../flowRunExport';
import { FlowAssistPanel } from '../assist/FlowAssistPanel';
import { FlowOutline } from './FlowOutline';
import { collectStepIssues } from './stepIssues';

/** The outline's width beside the editor (Notion's and Docs' outlines are 240–280px). */
export const OUTLINE_WIDTH = 264;
/** Below this editor width the 560px column and the outline do not both fit: it becomes a drawer. */
export const OUTLINE_BESIDE_MIN_WIDTH = 880;

interface OutlinePaneProps {
  flow: FlowDefinition;
  t: (key: string) => string;
  /** The editor is too narrow to have it beside: a drawer over the editor's right edge. */
  narrow: boolean;
}

/**
 * The outline beside the editor's column, or over its right edge as a drawer when the editor is
 * narrow (closed until asked for; picking a step, Escape, the backdrop, another flow and the
 * editor widening close it). What it shows comes from the draft flow and the open flow's last run.
 */
export const OutlinePane: React.FC<OutlinePaneProps> = ({ flow: draft, t, narrow }) => {
  // A step behind while typing: the outline redraws after the keystroke's card, not before it.
  const flow = useDeferredValue(draft);
  const { open, drawerOpen, setDrawerOpen, prune } = useFlowOutlineStore(useShallow((s) => ({
    open: s.open, drawerOpen: s.drawerOpen, setDrawerOpen: s.setDrawerOpen, prune: s.prune,
  })));
  const shown = narrow ? drawerOpen : open;

  const stepIdsKey = flow.steps.map((step) => step.id).join('\n');
  useEffect(() => {
    prune(flow.id, new Set(stepIdsKey ? stepIdsKey.split('\n') : []));
  }, [flow.id, stepIdsKey, prune]);

  // Ctrl+F in an open flow finds a step: the outline comes out for it if it is not out.
  const focusSearch = useFlowOutlineStore((s) => s.focusSearch);
  const setOpen = useFlowOutlineStore((s) => s.setOpen);
  useEffect(() => {
    if (focusSearch === 0) return;
    useFlowAssistStore.getState().setTab('steps');
    if (narrow) setDrawerOpen(true);
    else if (!useFlowOutlineStore.getState().open) setOpen(true);
    // Only a new request opens it, not the editor crossing the width.
  }, [focusSearch]);

  // A different flow or the editor widening closes the drawer.
  useEffect(() => { setDrawerOpen(false); }, [flow.id, narrow, setDrawerOpen]);
  useEffect(() => {
    if (!narrow || !drawerOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [narrow, drawerOpen, setDrawerOpen]);

  const executionLogs = useFlowStore((s) => s.executionLogs);
  const flowRunning = useFlowStore((s) => s.runningFlowIds.includes(flow.id));
  const byStep = useMemo(() => stepLogsById(executionLogs.filter((log) => log.flowId === flow.id)), [executionLogs, flow.id]);
  const runStates = useMemo(() => {
    const states = new Map<string, ProgressState>();
    byStep.forEach((log, id) => states.set(id, stepMark(log.status, flowRunning, log.error)));
    return states;
  }, [byStep, flowRunning]);
  const runSummary = useMemo(() => {
    if (byStep.size === 0) return null;
    const spot = runSpot(flow.steps, byStep, flowRunning);
    if (!spot) return t(flowRunning ? 'flow.outline.run.active' : 'flow.outline.run.done');
    return fillTemplate(t(RUN_SPOT_LABEL_KEY[spot.kind]), { step: String(spot.position) });
  }, [byStep, flow.steps, flowRunning, t]);

  const { tab, setTab } = useFlowAssistStore(useShallow((s) => ({ tab: s.tab, setTab: s.setTab })));
  // Only while it is on screen: the checks walk every step and every reference.
  const issues = useMemo(() => (shown && tab === 'steps' ? collectStepIssues(flow, t) : new Map()), [shown, tab, flow, t]);
  const triggerSummary = useMemo(() => [flow.trigger, ...(flow.extraTriggers ?? [])]
    .map((trigger) => triggerFact(trigger, t, isMac)).join(' · '), [flow.trigger, flow.extraTriggers, t]);

  if (!shown) return null;
  const outline = (
    <Stack gap={0} h="100%" miw={0}>
      <Box px={8} pt={8}>
        <AppSegmentedControl
          quiet
          size="xs"
          value={tab}
          onChange={(value) => setTab(value as OutlineTab)}
          options={[
            { value: 'steps', label: t('flow.outline.tab.steps') },
            { value: 'assist', label: t('flow.assist.tab') },
          ]}
        />
      </Box>
      <Box flex={1} miw={0} style={{ minHeight: 0 }}>
        {tab === 'assist' ? (
          <FlowAssistPanel flow={draft} t={t} />
        ) : (
          <FlowOutline
            flow={flow}
            t={t}
            issues={issues}
            runStates={runStates}
            runSummary={runSummary}
            triggerSummary={triggerSummary}
            onPicked={narrow ? () => setDrawerOpen(false) : undefined}
          />
        )}
      </Box>
    </Stack>
  );
  return (
    <>
      <Box
        component="aside"
        aria-label={t('flow.outline.title')}
        data-outline-drawer={narrow ? '' : undefined}
        w={OUTLINE_WIDTH}
        h="100%"
        bg="var(--mantine-color-body)"
        style={narrow
          ? { position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 5, boxShadow: 'var(--mantine-shadow-md)' }
          : { flexShrink: 0, borderLeft: '1px solid var(--mantine-color-default-border)' }}
      >
        {outline}
      </Box>
      {narrow && (
        <Overlay backgroundOpacity={BACKDROP_OPACITY} zIndex={4} onClick={() => setDrawerOpen(false)} data-outline-backdrop="" />
      )}
    </>
  );
};
