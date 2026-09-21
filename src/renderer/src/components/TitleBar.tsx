import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button as MButton, Flex, Group, Text, Tooltip } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { NAV_ORDER, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { useAltKeyHeld } from '../hooks/useAltKeyHeld';
import { useFlowIssues } from '../hooks/useFlowIssues';
import { hasAnyFlowIssue } from '../../../shared/flowIssues';
import type { View } from '../store/appStore';
import { FLOW_COMMAND_ICON as FlowIcon } from '../config/chatModes';
import { AppWindow, Info, ListOrdered, MessageSquare, ScrollText, Settings } from 'lucide-react';
import { agentApi, flowApi, systemApi } from '../api/electronApi';
import { useAgentRunStore } from '../store/useAgentRunStore';
import { useFlowBuildStore } from '../store/useFlowBuildStore';
import {
  isMac,
  navScrollStyle,
  statusWrapperStyle,
  titleBarDynStyle,
} from './titlebar/constants';
import { MacWindowControls, WindowsControls } from './titlebar/WindowControls';
import { QueuePopover } from './titlebar/QueuePopover';
import styles from './TitleBar.module.css';

const NAV_META: Record<View, { labelKey: string; icon: React.ReactNode }> = {
  chat: { labelKey: 'nav.chat', icon: <MessageSquare size={13} /> },
  flow: { labelKey: 'nav.flow', icon: <FlowIcon size={13} /> },
  logs: { labelKey: 'nav.logs', icon: <ScrollText size={13} /> },
  settings: { labelKey: 'nav.settings', icon: <Settings size={13} /> },
  about: { labelKey: 'nav.about', icon: <Info size={13} /> },
};

/**
 * The only cue a user gets while sitting in another view, so an unreadable secret has to
 * outrank an available update: a dead bot token is already breaking things, an update is not.
 */
function navHighlight(
  id: View,
  currentView: View,
  hasUpdate: boolean,
  secretsBroken: boolean,
  flowBroken: boolean,
): string | undefined {
  if (id === 'settings' && secretsBroken && currentView !== 'settings') return '0 0 0 1px var(--mantine-color-red-6)';
  // A clashing bot command or an unfilled required setting means a flow the user
  // believes is armed answers nothing — same urgency band as an update, orange.
  if (id === 'flow' && flowBroken && currentView !== 'flow') return '0 0 0 1px var(--mantine-color-orange-6)';
  if (id === 'about' && hasUpdate && currentView !== 'about') return '0 0 0 1px var(--mantine-color-orange-6)';
  return undefined;
}

export const TitleBar: React.FC = () => {
  const { currentView, setView, status, queue } = useAppStore(
    useShallow((s) => ({
      currentView: s.currentView,
      setView: s.setView,
      status: s.status,
      queue: s.queue,
    })),
  );
  const { t, locale } = useI18nStore();
  const hasUpdate = useUpdateStore((state) => state.hasUpdate);
  const secretsBroken = useSecretHealthStore((state) => state.failures.length > 0);
  const flowBroken = hasAnyFlowIssue(useFlowIssues());
  const agentTraces = useAgentRunStore((state) => state.traces);

  useEffect(() => agentApi.onTrace((payload) => useAgentRunStore.getState().applyTrace(payload)), []);
  // Subscribed next to the trace because it is the other half of the same picture: an `/agent`
  // run can start building a flow from any view, including one that has no panel open.
  useEffect(() => flowApi.onBuildProgress((payload) => useFlowBuildStore.getState().applyBuild(payload)), []);
  const handleCancelAgent = useCallback((runId: string): void => { void agentApi.cancel(runId); }, []);
  const barRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const tightThresholdRef = useRef(0);
  const [isTight, setIsTight] = useState(false);
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const [cancelingTaskIds, setCancelingTaskIds] = useState<Record<string, boolean>>({});
  const [isForceSkipping, setIsForceSkipping] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({ top: 52, right: 6 });
  const queuePopoverCloseTimerRef = useRef<number | null>(null);
  const statusBadgeRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    const bar = barRef.current;
    const nav = navRef.current;
    if (!bar || !nav) return;
    const evaluate = (): void => {
      const barWidth = bar.clientWidth;
      if (!isTight) {
        if (nav.scrollWidth > nav.clientWidth + 2) {
          tightThresholdRef.current = barWidth;
          setIsTight(true);
        }
      } else if (barWidth > tightThresholdRef.current + 32) {
        setIsTight(false);
      }
    };
    evaluate();
    const observer = new ResizeObserver(evaluate);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isTight, locale]);

  const navItems = useMemo(
    () => NAV_ORDER.map((id) => ({ id, label: t(NAV_META[id].labelKey), icon: NAV_META[id].icon })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const altHeld = useAltKeyHeld();
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

  const statusLabel = hasQueueItems
    ? isProcessing
      ? t('status.processing').replace('{{count}}', String(queue.total))
      : t('status.queuePending').replace('{{count}}', String(queuePending))
    : t('status.ready');

  const statusColor = hasQueueItems
    ? isProcessing ? 'var(--mantine-color-warning)' : 'var(--mantine-color-accent)'
    : 'var(--mantine-color-success)';

  const statusBackground = hasQueueItems
    ? isProcessing ? 'rgba(210,153,34,0.14)' : 'var(--mantine-color-accent-dim)'
    : 'rgba(63,185,80,0.14)';

  const statusBorder = hasQueueItems
    ? isProcessing ? 'rgba(210,153,34,0.32)' : 'rgba(56,139,253,0.35)'
    : 'rgba(63,185,80,0.32)';

  const workerIcon = <AppWindow size={15} />;
  const workerTitle = t('titlebar.worker.open');

  return (
    <Flex
      ref={barRef}
      align="center"
      gap={0}
      className={styles.bar}
      style={titleBarDynStyle}
    >
      {isMac && <MacWindowControls t={t} focused={windowFocused} />}

      <Flex ref={navRef} gap={isTight ? 4 : 8} style={navScrollStyle}>
        {navItems.map((item, index) => {
          const icon = altHeld ? (
            <Text component="span" w={15} ta="center" fz={13} fw={700} lh={1}>
              {index + 1}
            </Text>
          ) : (
            item.icon
          );
          return (
            <Box key={item.id} pos="relative" display="inline-flex">
              <Tooltip label={item.label} position="bottom" disabled={!isTight}>
                <MButton
                  onClick={() => setView(item.id)}
                  variant={currentView === item.id ? 'filled' : 'subtle'}
                  color={currentView === item.id ? undefined : 'gray'}
                  size="compact-xs"
                  radius={isTight ? 999 : 'xl'}
                  leftSection={!isTight ? icon : undefined}
                  h={32}
                  w={isTight ? 32 : undefined}
                  style={{
                    '--button-hover': currentView !== item.id ? 'var(--mantine-color-default-hover)' : undefined,
                    padding: isTight ? 0 : '6px 12px',
                    flexShrink: 0,
                    boxShadow: navHighlight(item.id, currentView, hasUpdate, secretsBroken, flowBroken),
                  } as React.CSSProperties}
                >
                  {isTight ? icon : item.label}
                </MButton>
              </Tooltip>
            </Box>
          );
        })}
      </Flex>

      <Box className={styles.spacer} />

      <Box mr={6} style={statusWrapperStyle}>
        <Tooltip label={workerTitle} position="bottom" disabled={!isTight}>
          <MButton
            onClick={() => systemApi.showWorker()}
            aria-label={workerTitle}
            variant="subtle"
            color="gray"
            size="compact-xs"
            radius={isTight ? 999 : 'xl'}
            leftSection={!isTight ? workerIcon : undefined}
            h={32}
            w={isTight ? 32 : undefined}
            style={{
              '--button-hover': 'var(--mantine-color-default-hover)',
              padding: isTight ? 0 : '6px 12px',
              flexShrink: 0,
            } as React.CSSProperties}
          >
            {isTight ? workerIcon : workerTitle}
          </MButton>
        </Tooltip>
      </Box>

      <Box
        pos="relative"
        mr={6}
        style={statusWrapperStyle}
        onMouseEnter={openQueuePopover}
        onMouseLeave={closeQueuePopoverSoon}
      >
        <Group
          ref={statusBadgeRef}
          gap={6}
          px={12}
          h={32}
          className={styles.statusBadge}
          style={{
            background: statusBackground,
            color: statusColor,
            border: `1px solid ${statusBorder}`,
            cursor: hasQueueItems ? 'pointer' : 'default',
          }}
        >
          <Box
            component="span"
            w={7}
            h={7}
            display="inline-block"
            style={{
              borderRadius: '50%',
              flexShrink: 0,
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          {hasQueueItems && <ListOrdered size={12} />}
          {!isTight && statusLabel}
        </Group>

        {queuePopoverOpen && hasQueueItems && (
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

      {!isMac && <WindowsControls t={t} focused={windowFocused} />}
    </Flex>
  );
};
