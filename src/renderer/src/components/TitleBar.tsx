import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Flex, Group } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useShallow } from 'zustand/react/shallow';
import { drawnView, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { AppWindow, ListOrdered } from 'lucide-react';
import { agentApi, flowApi, systemApi } from '../api/electronApi';
import { useAgentRunStore } from '../store/useAgentRunStore';
import { useFlowBuildStore } from '../store/useFlowBuildStore';
import { isMac } from '../utils/keyLabels';
import { CAPTION_ROW, statusWrapperStyle } from './titlebar/constants';
import { MacWindowControls, WindowsControls } from './titlebar/WindowControls';
import { QueuePopover } from './titlebar/QueuePopover';
import { TOP_ROW_HEIGHT, ToolbarIconButton } from './PanelToolbar';
import { AppButton } from './AppButton';
import { useCaptionStore } from '../store/captionStore';
import styles from './TitleBar.module.css';
import { fillTemplate } from '../../../shared/fillTemplate';

/**
 * The window width from which 「瀏覽器視窗」 shows its name (the default window is 1100). From here
 * the rows under the wider controls keep what they show, with the longest built-in name (English):
 * the flow editor's band its words, the chat header its title.
 */
export const WORKER_LABEL_MIN_WINDOW = 1_050;

/** Publishes an element's width as a CSS variable on the root, for the top rows to leave room. */
function usePublishedWidth(ref: React.RefObject<HTMLElement | null>, variable: string): void {
  // Before the first paint, so no row is ever drawn under the controls and then moves.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const root = document.documentElement;
    const write = (): void => root.style.setProperty(variable, `${Math.ceil(element.getBoundingClientRect().width)}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(variable);
    };
  }, [ref, variable]);
}

/**
 * The window's caption controls, floating over the end of whichever view's top row is showing:
 * there is no title bar band, each view's top row is the title bar (`CAPTION_ROW`). At the top
 * right the queue while something is queued or running, the browser window and the window buttons;
 * on macOS the traffic lights at the top left instead. Their widths are published as
 * `--caption-right` / `--caption-left`, the room the row at that edge leaves. Mounted after the
 * views: Electron applies drag regions in document order, so these buttons cut their holes last.
 *
 * The views are not listed here: Chat and Flow switch at the top of their sidebar, Settings is its
 * foot, and Logs and About are pages of Settings (see `ViewNav`). Settings is a dialog under these
 * controls (`Z_SETTINGS`): they stay clickable over its backdrop, and the view they float over is
 * the one drawn behind it.
 */
export const TitleBar: React.FC = () => {
  const { status, queue, currentView } = useAppStore(
    useShallow((s) => ({
      status: s.status,
      queue: s.queue,
      currentView: drawnView(s),
    })),
  );
  const t = useI18nStore((s) => s.t);
  const wideWindow = useMediaQuery(`(min-width: ${WORKER_LABEL_MIN_WINDOW}px)`, true, { getInitialValueInEffect: false });
  const narrowPane = useCaptionStore((s) => s.narrowIn.includes(currentView));
  const workerLabelled = wideWindow && !narrowPane;
  const agentTraces = useAgentRunStore((state) => state.traces);

  useEffect(() => agentApi.onTrace((payload) => useAgentRunStore.getState().applyTrace(payload)), []);
  // Subscribed next to the trace because it is the other half of the same picture: an `/agent`
  // run can start building a flow from any view, including one that has no panel open.
  useEffect(() => flowApi.onBuildProgress((payload) => useFlowBuildStore.getState().applyBuild(payload)), []);
  const handleCancelAgent = useCallback((runId: string): void => { void agentApi.cancel(runId); }, []);
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const [cancelingTaskIds, setCancelingTaskIds] = useState<Record<string, boolean>>({});
  const [isForceSkipping, setIsForceSkipping] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({ top: 52, right: 6 });
  const queuePopoverCloseTimerRef = useRef<number | null>(null);
  const statusBadgeRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const trafficLightsRef = useRef<HTMLDivElement>(null);
  usePublishedWidth(clusterRef, '--caption-right');
  usePublishedWidth(trafficLightsRef, '--caption-left');

  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const onFocus = (): void => setWindowFocused(true);
    const onBlur = (): void => setWindowFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => () => {
    if (queuePopoverCloseTimerRef.current) {
      window.clearTimeout(queuePopoverCloseTimerRef.current);
    }
  }, []);

  const isProcessing = status === 'processing';
  const hasQueueItems = queue.total > 0;
  const queuePending = Math.max(queue.total - queue.current, 0);

  useEffect(() => {
    if (!hasQueueItems) {
      setQueuePopoverOpen(false);
    }
  }, [hasQueueItems]);

  const openQueuePopover = (): void => {
    if (!hasQueueItems) return;
    if (queuePopoverCloseTimerRef.current) {
      window.clearTimeout(queuePopoverCloseTimerRef.current);
      queuePopoverCloseTimerRef.current = null;
    }
    if (statusBadgeRef.current) {
      const rect = statusBadgeRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setQueuePopoverOpen(true);
  };

  const closeQueuePopoverSoon = (): void => {
    if (queuePopoverCloseTimerRef.current) {
      window.clearTimeout(queuePopoverCloseTimerRef.current);
    }
    queuePopoverCloseTimerRef.current = window.setTimeout(() => {
      setQueuePopoverOpen(false);
      queuePopoverCloseTimerRef.current = null;
    }, 140);
  };

  const handleCancelQueueTask = useCallback(async (taskId: string): Promise<void> => {
    setCancelingTaskIds((prev) => ({ ...prev, [taskId]: true }));
    try {
      await window.electronAPI.cancelQueueTask(taskId);
    } finally {
      setCancelingTaskIds((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  }, []);

  const handleForceSkipActiveTask = useCallback(async (): Promise<void> => {
    setIsForceSkipping(true);
    try {
      await window.electronAPI.forceSkipActiveTask();
    } finally {
      setIsForceSkipping(false);
    }
  }, []);

  // The pill exists only while something is queued or running; an idle state tells the user nothing.
  const statusLabel = isProcessing
    ? fillTemplate(t('status.processing'), { count: String(queue.total) })
    : fillTemplate(t('status.queuePending'), { count: String(queuePending) });
  const statusColor = isProcessing ? 'var(--mantine-color-warning)' : 'var(--mantine-color-accent)';

  return (
    <>
      {isMac && (
        <Flex ref={trafficLightsRef} {...CAPTION_ROW} h={TOP_ROW_HEIGHT} align="center" className={`${styles.caption} ${styles.trafficLights}`}>
          <MacWindowControls t={t} focused={windowFocused} />
        </Flex>
      )}
      {/* The window buttons end it at the window's edge; without them (macOS) it keeps a toolbar's inset. */}
      <Flex ref={clusterRef} {...CAPTION_ROW} h={TOP_ROW_HEIGHT} pr={isMac ? 10 : 0} align="center" gap={6} className={`${styles.caption} ${styles.cluster}`}>
        {/* Left of the browser-window button, so appearing and disappearing pushes nothing else. */}
        {hasQueueItems && (
          <Box
            pos="relative"
            style={statusWrapperStyle}
            onMouseEnter={openQueuePopover}
            onMouseLeave={closeQueuePopoverSoon}
          >
            <Group
              ref={statusBadgeRef}
              gap={6}
              px={12}
              h={30}
              className={styles.statusBadge}
              style={{
                background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
                color: statusColor,
                border: `1px solid color-mix(in srgb, ${statusColor} 34%, transparent)`,
                cursor: 'pointer',
              }}
            >
              <Box
                component="span"
                w={7}
                h={7}
                display="inline-block"
                style={{ borderRadius: '50%', flexShrink: 0, background: statusColor }}
              />
              <ListOrdered size={12} />
              {statusLabel}
            </Group>

            {queuePopoverOpen && (
              <QueuePopover
                pos={popoverPos}
                items={queue.items}
                cancelingTaskIds={cancelingTaskIds}
                isForceSkipping={isForceSkipping}
                onCancelTask={handleCancelQueueTask}
                onForceSkip={handleForceSkipActiveTask}
                agentTraces={agentTraces}
                onCancelAgent={handleCancelAgent}
                onMouseEnter={openQueuePopover}
                onMouseLeave={closeQueuePopoverSoon}
                t={t}
              />
            )}
          </Box>
        )}

        {/* Named while the window has the room; narrower, an icon like the toolbar buttons beside
            it, named by its tooltip, so the rows under the controls keep theirs. */}
        {workerLabelled ? (
          <AppButton
            variant="subtle"
            size="xs"
            h={30}
            px={10}
            radius="sm"
            leftSection={<AppWindow size={15} />}
            onClick={() => systemApi.showWorker()}
          >
            {t('titlebar.worker.open')}
          </AppButton>
        ) : (
          <ToolbarIconButton icon={AppWindow} label={t('titlebar.worker.open')} onClick={() => systemApi.showWorker()} />
        )}

        {!isMac && <WindowsControls t={t} focused={windowFocused} />}
      </Flex>
    </>
  );
};
