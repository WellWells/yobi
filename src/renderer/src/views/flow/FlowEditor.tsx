import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Badge, Box, Flex, Group, Loader, Menu, Stack, Text, Tooltip, UnstyledButton,
} from '@mantine/core';
import { useElementSize, useMergedRef } from '@mantine/hooks';
import {
  ArrowDown, ArrowUp, Copy, EllipsisVertical, OctagonX, Play, RotateCcw, RotateCcwClock, Save, Sparkles, Square, TableOfContents, Trash,
  TriangleExclamationPoint, Upload,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../../store/useFlowStore';
import { useFlowOutlineStore } from '../../store/useFlowOutlineStore';
import { useFlowAssistStore } from '../../store/useFlowAssistStore';
import { useWidthBelow } from '../../hooks/useWidthBelow';
import { locateStep } from './outline/locateStep';
import { FLOW_SECTION_IDS, noteEditorFocus } from './outline/FlowOutline';
import { OUTLINE_BESIDE_MIN_WIDTH, OUTLINE_WIDTH, OutlinePane } from './outline/OutlinePane';
import { useReadingPosition } from './outline/useReadingPosition';
import { EDITOR_WIDE_MIN_WIDTH, editorColumnWidth } from './editorColumn';
import { AppTextarea } from '../../components/AppTextarea';
import { RenameInput } from '../../components/RenameInput';
import { flowAiSource } from '../../../../shared/aiName';
import { PANEL_TOOLBAR_PY } from '../../components/PanelToolbar';
import { CAPTION_RIGHT, CAPTION_ROW, captionPad } from '../../components/titlebar/constants';
import { SidebarDrawerButton } from '../../components/SidebarDrawer';
import { useNarrowWindow } from '../../hooks/useNarrowWindow';
import { FlowBandButton } from './FlowBandButton';
import { SectionCard } from '../../components/SectionCard';
import { ExecutionResultPanel } from './ExecutionResultPanel';
import { FlowStepsCard } from './FlowStepsCard';
import { FlowVariablesPanel } from './FlowVariablesPanel';
import { TriggerEditor } from './TriggerEditor';
import { FlowVersionsDialog } from './FlowVersionsDialog';
import { runSkillAddHook } from './skillAddHooks';
import { RUN_SPOT_LABEL_KEY, runSpot, stepLogsById, type RunSpot } from './flowRunExport';
import { flowDiffersFromSaved } from './flowDirty';
import type { FlowDefinition, FlowVariable, SkillType } from '../../../../shared/types';
import { useShortcutAction } from '../../shortcuts/useShortcutAction';
import { fillTemplate } from '../../../../shared/fillTemplate';

/** Below this the top band's buttons drop their words (`FlowBandButton`). */
const BAND_WORDS_MIN_WIDTH = 400;
/** The same while the band also says which step failed or runs (about 100px more in English). */
const BAND_WORDS_WITH_SPOT_MIN_WIDTH = 500;

/** "Failed at step 3" / "Running step 3" / "Ended early at step 3" in the band; a click scrolls to that step's card. */
const RunSpotButton: React.FC<{ spot: RunSpot; compact: boolean; t: (k: string) => string }> = ({ spot, compact, t }) => {
  const failed = spot.kind === 'failed';
  const label = fillTemplate(t(RUN_SPOT_LABEL_KEY[spot.kind]), { step: String(spot.position) });
  const scroll = (): void => {
    locateStep(spot.stepId, { expand: true });
  };
  return (
    <Tooltip label={label} position="bottom" disabled={!compact}>
      <UnstyledButton onClick={scroll} aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {failed && <TriangleExclamationPoint size={14} color="var(--mantine-color-error)" />}
        {spot.kind === 'running' && <Loader size={12} />}
        {spot.kind === 'stopped' && <OctagonX size={14} color="var(--text-muted)" />}
        {!compact && (
          <Text fz="xs" c={failed ? 'var(--mantine-color-error)' : 'var(--text-muted)'} style={{ whiteSpace: 'nowrap' }}>{label}</Text>
        )}
      </UnstyledButton>
    </Tooltip>
  );
};

export interface FlowEditorProps {
  flow: FlowDefinition;
  t: (k: string) => string;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export const FlowEditor: React.FC<FlowEditorProps> = ({
  flow, t, onDelete, onDuplicate, onExport, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}) => {
  const {
    updateFlow, saveFlow, executeFlow, abortFlow, addStep, isExecuting, runningFlowIds, restoreFlow, savedFlows,
  } = useFlowStore(
    useShallow((s) => ({
      updateFlow: s.updateFlow,
      saveFlow: s.saveFlow,
      executeFlow: s.executeFlow,
      abortFlow: s.abortFlow,
      addStep: s.addStep,
      isExecuting: s.isExecuting,
      runningFlowIds: s.runningFlowIds,
      restoreFlow: s.restoreFlow,
      savedFlows: s.savedFlows,
    })),
  );
  const hasExecutionLogs = useFlowStore((s) => s.executionLogs.length > 0);
  const isThisRunning = runningFlowIds.includes(flow.id);
  // Shallow-compared, so a new log line redraws the editor only when the step it points at changes.
  const spot = useFlowStore(useShallow((s) => runSpot(
    flow.steps,
    stepLogsById(s.executionLogs.filter((log) => log.flowId === flow.id)),
    s.runningFlowIds.includes(flow.id),
  )));
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const setViewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    setViewport(node);
  }, []);
  const [outlineRef, outlineNarrow] = useWidthBelow(OUTLINE_BESIDE_MIN_WIDTH);
  const [columnRef, columnNarrow] = useWidthBelow(EDITOR_WIDE_MIN_WIDTH);
  const rootRef = useMergedRef(outlineRef, columnRef);
  const column = editorColumnWidth(!columnNarrow);
  const { outlineOpen, setOutlineOpen, drawerOpen, setDrawerOpen } = useFlowOutlineStore(useShallow((s) => ({
    outlineOpen: s.open, setOutlineOpen: s.setOpen, drawerOpen: s.drawerOpen, setDrawerOpen: s.setDrawerOpen,
  })));
  const { assistTab, setAssistTab, requestAssistFocus } = useFlowAssistStore(useShallow((s) => ({
    assistTab: s.tab, setAssistTab: s.setTab, requestAssistFocus: s.requestInputFocus,
  })));
  const outlineBeside = outlineOpen && !outlineNarrow;
  const outlineShown = outlineNarrow ? drawerOpen : outlineOpen;
  const toggleOutline = (): void => {
    if (outlineNarrow) setDrawerOpen(!drawerOpen);
    else setOutlineOpen(!outlineOpen);
  };
  const stepIdsKey = flow.steps.map((step) => step.id).join('\n');
  useReadingPosition(outlineShown ? viewport : null, flow.id, stepIdsKey);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const savedFlow = savedFlows[flow.id];
  const isDirty = useMemo(() => flowDiffersFromSaved(flow, savedFlow), [flow, savedFlow]);

  // Back to the top when a different flow is opened: the editor stays mounted across the switch.
  // useLayoutEffect, or the old offset flashes for a frame.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [flow.id]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsPinned(!(entry?.isIntersecting ?? true)),
      { root: viewport, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // The editor's own Save (button or shortcut) is the owner's review of the flow they have open.
  const handleSave = useCallback(async () => { await saveFlow(flow, undefined, true); }, [flow, saveFlow]);
  const handleRestore = useCallback(() => { restoreFlow(flow.id); }, [flow.id, restoreFlow]);
  const handleRun = useCallback(async () => {
    await saveFlow(flow);
    await executeFlow(flow.id);
  }, [flow, saveFlow, executeFlow]);
  const handleStop = useCallback(() => { void abortFlow(flow.id); }, [abortFlow, flow.id]);
  // Words need about 400px (the badge, three labelled buttons and ⋮); at the window's narrowest the
  // band, beside the caption controls, has half that.
  const { ref: bandRef, width: bandWidth } = useElementSize();
  const narrowWindow = useNarrowWindow();
  const compact = bandWidth > 0 && bandWidth < (spot ? BAND_WORDS_WITH_SPOT_MIN_WIDTH : BAND_WORDS_MIN_WIDTH);

  useShortcutAction('flow.save', () => {
    if (isDirty) void handleSave();
  }, 'flow');

  const handleAddStep = useCallback((type: SkillType) => {
    const id = addStep(flow.id, type);
    runSkillAddHook(type);
    // It may land inside a folded block: open that and bring the new card into view.
    if (id) locateStep(id);
  }, [addStep, flow.id]);
  const handleVariablesChange = useCallback((variables: FlowVariable[]) => {
    updateFlow({ ...flow, variables });
  }, [flow, updateFlow]);

  // The band's column (560px, 720px in a wide editor) sits over the editor's column, which the
  // outline beside it moves left.
  const aside = outlineBeside ? `${OUTLINE_WIDTH}px` : '0px';
  const columnPx = `${column}px`;
  const assistShown = outlineShown && assistTab === 'assist';
  const outlineLabel = t(outlineShown && !assistShown ? 'flow.outline.hide' : 'flow.outline.show');
  // The assistant is the right pane's other tab: this opens the pane on it, or closes it.
  const toggleAssist = (): void => {
    if (assistShown) {
      toggleOutline();
      return;
    }
    setAssistTab('assist');
    if (!outlineShown) toggleOutline();
    requestAssistFocus();
  };

  return (
    <Flex ref={rootRef} direction="column" h="100%" style={{ overflow: 'hidden' }}>
      {/* The editor's top band is the window's title bar over it. */}
      <Box
        {...CAPTION_ROW}
        bg="var(--mantine-color-default)"
        style={{
          zIndex: 3,
          flexShrink: 0,
          transition: 'box-shadow 160ms ease, border-color 160ms ease',
          boxShadow: isPinned ? '0 8px 20px rgba(0, 0, 0, 0.18)' : 'none',
          borderBottom: isPinned ? '1px solid var(--mantine-color-default-border)' : '1px solid transparent',
          display: 'flex',
        }}
      >
        {/* A narrow window has the flow list in a drawer; the way to it starts the row, at the
            window's edge (after macOS's traffic lights), outside the band's own column. */}
        {narrowWindow && (
          <Box py={PANEL_TOOLBAR_PY} pl={captionPad('left', 'left', 8)} style={{ flexShrink: 0 }}>
            <SidebarDrawerButton />
          </Box>
        )}
        <Box flex={1} miw={0}>
        {/* Over the column below while there is room. Once the caption controls floating at
            the row's end would reach it, it stops short of them and moves left, keeping its width:
            its controls sit at its end, so its left part is empty and gives way first. Only with
            no left margin left does it narrow. */}
        <Box
          maw={column}
          px="20px"
          py={PANEL_TOOLBAR_PY}
          style={{
            marginLeft: `max(0px, min(calc((100% - ${aside} - ${columnPx}) / 2), calc(100% - ${columnPx} - ${CAPTION_RIGHT})))`,
            marginRight: `max(calc((100% - ${aside} - ${columnPx}) / 2 + ${aside}), ${CAPTION_RIGHT})`,
          }}
        >
          <Group ref={bandRef} justify="flex-end" align="center" wrap="nowrap" gap={compact ? 8 : 'md'}>
            {spot && <RunSpotButton spot={spot} compact={compact} t={t} />}
            {isDirty ? (
              <Badge color="var(--mantine-color-warning)" variant="light">{t('flow.unsaved')}</Badge>
            ) : (
              !compact && <Text fz="xs" c="dimmed">{t('flow.saved')}</Text>
            )}
            <FlowBandButton compact={compact} label={t('flow.restore')} icon={<RotateCcw size={14} />} onClick={handleRestore} disabled={!isDirty} />
            <FlowBandButton compact={compact} label={t('flow.saveFlow')} icon={<Save size={14} />} onClick={() => { void handleSave(); }} disabled={!isDirty} />
            {isThisRunning ? (
              <FlowBandButton compact={compact} tone="danger" label={t('flow.stopFlow')} icon={<Square size={13} fill="currentColor" />} onClick={handleStop} />
            ) : (
              <FlowBandButton
                compact={compact}
                tone="primary"
                label={t('flow.runFlow')}
                icon={isExecuting ? <Loader size={14} color="white" /> : <Play size={14} />}
                onClick={() => { void handleRun(); }}
                disabled={isExecuting}
              />
            )}
            <Tooltip label={t('flow.assist.open')} position="bottom">
              <ActionIcon
                variant="subtle"
                size="md"
                aria-label={t('flow.assist.open')}
                aria-pressed={assistShown}
                onClick={toggleAssist}
                data-assist-toggle=""
              >
                <Sparkles size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={outlineLabel} position="bottom">
              <ActionIcon
                variant="subtle"
                size="md"
                aria-label={outlineLabel}
                aria-pressed={outlineShown && !assistShown}
                onClick={() => {
                  // Open on the assistant's tab: this button shows the steps rather than closing the pane.
                  if (assistShown) setAssistTab('steps');
                  else toggleOutline();
                }}
                data-outline-toggle=""
              >
                <TableOfContents size={14} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" withArrow shadow="md">
              <Menu.Target>
                <Tooltip label={t('common.moreActions')} position="bottom">
                  <ActionIcon variant="default" size="md" aria-label={t('common.moreActions')}>
                    <EllipsisVertical size={14} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Copy size={14} />} onClick={onDuplicate}>{t('flow.duplicateFlow')}</Menu.Item>
                <Menu.Item leftSection={<Upload size={14} />} onClick={onExport}>{t('flow.exportFlow')}</Menu.Item>
                <Menu.Item leftSection={<RotateCcwClock size={14} />} onClick={() => setVersionsOpen(true)}>{t('flow.versions.open')}</Menu.Item>
                <Menu.Item leftSection={<ArrowUp size={14} />} disabled={!canMoveUp} onClick={onMoveUp}>{t('flow.flow.moveUp')}</Menu.Item>
                <Menu.Item leftSection={<ArrowDown size={14} />} disabled={!canMoveDown} onClick={onMoveDown}>{t('flow.flow.moveDown')}</Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<Trash size={14} />} color="red" onClick={onDelete}>{t('flow.deleteFlow')}</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Box>
        </Box>
      </Box>
      <Flex flex={1} miw={0} mih={0} style={{ position: 'relative' }}>
      <Box
        flex={1}
        h="100%"
        miw={0}
        ref={setViewportRef}
        style={{ overflowY: 'auto' }}
        onFocusCapture={(event) => noteEditorFocus(event.target as HTMLElement)}
      >
        <Box ref={sentinelRef} h="1px" aria-hidden style={{ visibility: 'hidden', pointerEvents: 'none' }} />
        <Box p="24px 20px 40px">
          <Box maw={column} mx="auto">
            <Stack gap="xl">

              <SectionCard id={FLOW_SECTION_IDS.name}>
                <Stack gap="xs">
                  {/* One box per flow: a name asked for this flow goes with it when another opens. */}
                  <RenameInput
                    key={flow.id}
                    label={t('flow.flowName')}
                    placeholder={t('flow.flowName.placeholder')}
                    value={flow.name}
                    onChange={(name) => updateFlow({ ...flow, name })}
                    ai={flowAiSource(flow)}
                    mode="field"
                    size="lg"
                  />
                  <AppTextarea
                    label={t('common.description')}
                    placeholder={t('flow.flowDescription.placeholder')}
                    value={flow.description}
                    onChange={(e) => updateFlow({ ...flow, description: e.currentTarget.value })}
                    minRows={2}
                    autosize
                    size="sm"
                  />
                </Stack>
              </SectionCard>

              <SectionCard id={FLOW_SECTION_IDS.trigger}>
                <Stack gap="sm">
                  <Text fw={600} fz="sm" c="var(--mantine-color-default-color)">{t('flow.trigger')}</Text>
                  <TriggerEditor flow={flow} t={t} />
                </Stack>
              </SectionCard>

              <Box id={FLOW_SECTION_IDS.settings}>
                <FlowVariablesPanel flow={flow} t={t} onChange={handleVariablesChange} />
              </Box>

              <FlowStepsCard flow={flow} t={t} onAddStep={handleAddStep} />

              {hasExecutionLogs && (
                <Box id={FLOW_SECTION_IDS.results}>
                  <ExecutionResultPanel
                    steps={flow.steps}
                    flowName={flow.name}
                    t={t}
                  />
                </Box>
              )}
            </Stack>
          </Box>
        </Box>
      </Box>
      <OutlinePane flow={flow} t={t} narrow={outlineNarrow} />
      </Flex>
      <FlowVersionsDialog
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        flowId={flow.id}
        flowName={flow.name}
        dirty={isDirty}
        t={t}
      />
    </Flex>
  );
};
