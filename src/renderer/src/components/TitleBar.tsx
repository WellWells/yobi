import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button as MButton, Flex, Group, Tooltip } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import type { View } from '../store/appStore';
import { AgentFlowIcon } from './AgentFlowIcon';
import { AppWindow, Info, ListOrdered, LogIn, MessageSquare, ScrollText, Settings, ShieldAlert } from 'lucide-react';
import { systemApi } from '../api/electronApi';
import {
  isMac,
  navScrollStyle,
  statusWrapperStyle,
  titleBarDynStyle,
} from './titlebar/constants';
import { MacWindowControls, WindowsControls } from './titlebar/WindowControls';
import { QueuePopover } from './titlebar/QueuePopover';
import styles from './TitleBar.module.css';

export const TitleBar: React.FC = () => {
  const { currentView, setView, status, queue, workerAttention } = useAppStore(
    useShallow((s) => ({
      currentView: s.currentView,
      setView: s.setView,
      status: s.status,
      queue: s.queue,
      workerAttention: s.workerAttention,
    })),
  );
  const { t, locale } = useI18nStore();
  const hasUpdate = useUpdateStore((state) => state.hasUpdate);
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

  const navItems = useMemo(() => [
    { id: 'chat' as View, label: t('nav.chat'), icon: <MessageSquare size={13} /> },
    {
      id: 'agentflow' as View,
      label: t('nav.agentflow'),
      icon: <AgentFlowIcon size={15} />,
    },
    { id: 'logs' as View, label: t('nav.logs'), icon: <ScrollText size={13} /> },
    { id: 'settings' as View, label: t('nav.settings'), icon: <Settings size={13} /> },
    { id: 'about' as View, label: t('nav.about'), icon: <Info size={13} /> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale]);
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
      ? `${t('status.processing')} ${queue.current}/${queue.total}`
      : `${t('status.queuePending')}: ${queuePending}`
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

  const workerNeedsAttention = workerAttention !== 'idle';
  const workerIcon = workerAttention === 'login'
    ? <LogIn size={15} />
    : workerAttention === 'verification'
      ? <ShieldAlert size={15} />
      : <AppWindow size={15} />;
  const workerTitle = workerAttention === 'login'
    ? t('titlebar.worker.needLogin')
    : workerAttention === 'verification'
      ? t('titlebar.worker.needVerification')
      : t('titlebar.worker.open');

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
        {navItems.map((item) => (
          <Box key={item.id} pos="relative" display="inline-flex">
            <Tooltip label={item.label} position="bottom" disabled={!isTight}>
              <MButton
                onClick={() => setView(item.id)}
                variant={currentView === item.id ? 'filled' : 'subtle'}
                color={currentView === item.id ? undefined : 'gray'}
                size="compact-xs"
                radius={isTight ? 999 : 'xl'}
                leftSection={!isTight ? item.icon : undefined}
                h={32}
                w={isTight ? 32 : undefined}
                style={{
                  '--button-hover': currentView !== item.id ? 'var(--mantine-color-default-hover)' : undefined,
                  padding: isTight ? 0 : '6px 12px',
                  flexShrink: 0,
                  boxShadow: item.id === 'about' && hasUpdate && currentView !== 'about' ? '0 0 0 1px var(--mantine-color-orange-6)' : undefined,
                } as React.CSSProperties}
              >
                {isTight ? item.icon : item.label}
              </MButton>
            </Tooltip>
          </Box>
        ))}
      </Flex>

      <Box className={styles.spacer} />

      <Box mr={6} style={statusWrapperStyle}>
        <Tooltip label={workerTitle} position="bottom" disabled={!isTight}>
          <MButton
            onClick={() => systemApi.showWorker()}
            aria-label={workerTitle}
            variant={workerNeedsAttention ? 'light' : 'subtle'}
            color={workerNeedsAttention ? 'orange' : 'gray'}
            size="compact-xs"
            radius={isTight ? 999 : 'xl'}
            leftSection={!isTight ? workerIcon : undefined}
            h={32}
            w={isTight ? 32 : undefined}
            style={{
              '--button-hover': !workerNeedsAttention ? 'var(--mantine-color-default-hover)' : undefined,
              padding: isTight ? 0 : '6px 12px',
              flexShrink: 0,
              boxShadow: workerNeedsAttention ? '0 0 0 1px var(--mantine-color-orange-6)' : undefined,
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
