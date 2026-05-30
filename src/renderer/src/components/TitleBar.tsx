import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button as MButton, Flex, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import type { View } from '../store/appStore';
import { AgentFlowIcon } from './AgentFlowIcon';
import { Info, ListOrdered, LoaderCircle, MessageSquare, Minus, Plus, ScrollText, Settings, X, ListChecks } from 'lucide-react';
import styles from './TitleBar.module.css';

// ─── Module-level statics (computed once, never change) ────────────────────────
const noDrag: React.CSSProperties = { WebkitAppRegion: 'no-drag' };
const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
const isMac = (navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase().includes('mac');

// Titlebar requires WebkitAppRegion for Electron drag; padding is isMac-conditional but static.
const titleBarDynStyle: React.CSSProperties = {
  padding: isMac ? '0 10px' : '0 0 0 10px',
  WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion'],
};

// Static style constants extracted from components to avoid per-render object allocation.
const brandIconEmptyStyle: React.CSSProperties = { flexShrink: 0 };
const brandIconImgStyle: React.CSSProperties = { borderRadius: 4, flexShrink: 0, objectFit: 'contain' };
const brandGroupStyle: React.CSSProperties = { flexShrink: 0, minWidth: 0 };
const brandTextStyle: React.CSSProperties = { whiteSpace: 'nowrap' };
const navScrollStyle: React.CSSProperties = {
  ...noDrag,
  overflowX: 'auto',
  overflowY: 'hidden',
  minWidth: 0,
  flexShrink: 1,
  scrollbarWidth: 'none' as React.CSSProperties['scrollbarWidth'],
};
const updateDotStyle: React.CSSProperties = { borderRadius: '50%', pointerEvents: 'none', zIndex: 1 };
const statusWrapperStyle: React.CSSProperties = { ...noDrag, flexShrink: 0 };

// ─── Window action helpers ──────────────────────────────────────────────────────
function doWindowAction(action: 'minimize' | 'maximize' | 'close'): void {
  if (action === 'minimize') { window.electronAPI.minimizeWindow(); return; }
  if (action === 'maximize') { window.electronAPI.maximizeWindow(); return; }
  window.electronAPI.closeWindow();
}

function getWindowActionTitle(t: (k: string) => string, action: 'minimize' | 'maximize' | 'close'): string {
  if (action === 'minimize') return t('window.minimize');
  if (action === 'maximize') return t('window.maximize');
  return t('window.close');
}

// ─── Mac traffic-light button data ─────────────────────────────────────────────
const macWindowButtonDefs: Array<{ action: 'close' | 'minimize' | 'maximize'; color: string; icon: React.ReactNode }> = [
  { action: 'close', color: '#ff5f57', icon: <X size={9} strokeWidth={2.3} /> },
  { action: 'minimize', color: '#febc2e', icon: <Minus size={9} strokeWidth={2.3} /> },
  { action: 'maximize', color: '#28c840', icon: <Plus size={9} strokeWidth={2.3} /> },
];

const windowsMaximizeIcon = (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="1.25" y="1.25" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.2" shapeRendering="crispEdges" />
  </svg>
);

// ─── Windows button data ────────────────────────────────────────────────────────
type WinBtnAction = 'minimize' | 'maximize' | 'close';

const winButtonDefs: Array<{ action: WinBtnAction }> = [
  { action: 'minimize' },
  { action: 'maximize' },
  { action: 'close' },
];

const winButtonIcons: Record<WinBtnAction, React.ReactNode> = {
  minimize: <Minus size={14} strokeWidth={2.1} />,
  maximize: windowsMaximizeIcon,
  close: <X size={14} strokeWidth={2.1} />,
};

// ─── Brand icon ─────────────────────────────────────────────────────────────────
// Renders the app icon PNG loaded at runtime via IPC.
// Reserves a fixed-size slot while loading to prevent layout shift.
const BrandIcon: React.FC<{ dataUrl: string }> = ({ dataUrl }) => {
  if (!dataUrl) {
    return (
      <Box
        component="span"
        aria-hidden="true"
        w={18}
        h={18}
        display="inline-block"
        style={brandIconEmptyStyle}
      />
    );
  }
  return (
    <Box
      component="img"
      src={dataUrl}
      w={18}
      h={18}
      draggable={false}
      aria-hidden="true"
      style={brandIconImgStyle}
    />
  );
};

// ─── Mac window controls ────────────────────────────────────────────────────────
// Group hover is handled entirely by CSS: .macGroup:hover .macBtnIcon { opacity: 1 }
// No useState needed — no hover state tracked in JS.
const MacWindowControls = React.memo<{ t: (k: string) => string }>(({ t }) => (
  <Box className={styles.macGroup} style={noDrag}>
    {macWindowButtonDefs.map((btn) => (
      <UnstyledButton
        key={btn.action}
        onClick={() => doWindowAction(btn.action)}
        title={getWindowActionTitle(t, btn.action)}
        className={styles.macBtn}
        style={{ background: btn.color }}
      >
        <Box component="span" className={styles.macBtnIcon}>
          {btn.icon}
        </Box>
      </UnstyledButton>
    ))}
  </Box>
));

// ─── Windows window controls ────────────────────────────────────────────────────
// Hover effects handled entirely by CSS: .winBtn:hover and .winClose:hover
// No useState needed — no hover state tracked in JS.
const WindowsControls = React.memo<{ t: (k: string) => string }>(({ t }) => (
  <Box className={styles.winControls} style={noDrag}>
    {winButtonDefs.map(({ action }) => (
      <UnstyledButton
        key={action}
        onClick={() => doWindowAction(action)}
        title={getWindowActionTitle(t, action)}
        className={`${styles.winBtn}${action === 'close' ? ` ${styles.winClose}` : ''}`}
      >
        {winButtonIcons[action]}
      </UnstyledButton>
    ))}
  </Box>
));

export const TitleBar: React.FC = () => {
  const { currentView, setView, status, queue } = useAppStore();
  const { t, locale } = useI18nStore();
  const hasUpdate = useUpdateStore((state) => state.hasUpdate);
  const isTight = useMediaQuery('(max-width: 900px)', false, { getInitialValueInEffect: false }) ?? false;
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const [cancelingTaskIds, setCancelingTaskIds] = useState<Record<string, boolean>>({});
  const [appIconDataUrl, setAppIconDataUrl] = useState('');
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number }>({ top: 52, right: 6 });
  const queuePopoverCloseTimerRef = useRef<number | null>(null);
  const statusBadgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.electronAPI.getAppIconDataUrl().then(setAppIconDataUrl).catch(() => { });
  }, []);

  useEffect(() => () => {
    if (queuePopoverCloseTimerRef.current) {
      window.clearTimeout(queuePopoverCloseTimerRef.current);
    }
  }, []);

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
  ], [locale]); // locale changes trigger re-translation; t is stable
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

  return (
    <Flex
      align="center"
      gap={0}
      className={styles.bar}
      style={titleBarDynStyle}
    >
      {isMac && <MacWindowControls t={t} />}

      <Group gap={7} px={10} style={brandGroupStyle}>
        <BrandIcon dataUrl={appIconDataUrl} />
        <Text
          component="span"
          fw={700}
          fz="var(--font-size-md)"
          c="var(--mantine-color-accent)"
          lts="0.2px"
          style={brandTextStyle}
        >
          {t('app.name')}
        </Text>
      </Group>

      <Flex gap={isTight ? 4 : 8} style={navScrollStyle}>
        {navItems.map((item) => (
          <Box key={item.id} pos="relative" display="inline-flex">
            <MButton
              onClick={() => setView(item.id)}
              variant={currentView === item.id ? 'filled' : 'subtle'}
              color={currentView === item.id ? undefined : 'gray'}
              size="compact-xs"
              radius={isTight ? 999 : 'xl'}
              leftSection={!isTight ? item.icon : undefined}
              h={isTight ? 32 : 33}
              w={isTight ? 32 : undefined}
              miw={isTight ? 32 : undefined}
              style={{
                '--button-hover': currentView !== item.id ? 'var(--mantine-color-default-hover)' : undefined,
                padding: isTight ? 0 : '6px 12px',
                flexShrink: 0,
              } as React.CSSProperties}
            >
              {isTight ? item.icon : item.label}
            </MButton>
            {item.id === 'settings' && hasUpdate && (
              <Box
                pos="absolute"
                top={4}
                right={4}
                w={7}
                h={7}
                bg="var(--mantine-color-orange-6)"
                style={updateDotStyle}
              />
            )}
          </Box>
        ))}
      </Flex>

      <Box className={styles.spacer} />

      {/* onMouseEnter/onMouseLeave here are functional (show/hide popover), not for styling */}
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
          <Box
            className={styles.popover}
            style={{ top: popoverPos.top, right: popoverPos.right }}
            onMouseEnter={openQueuePopover}
            onMouseLeave={closeQueuePopoverSoon}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Box className={styles.popoverHeader}>
              <ListChecks size={16} style={{ flexShrink: 0 }} />
              <Text component="span">
                {t('queue.panel.title')}
              </Text>
            </Box>
            <Box className={styles.popoverBody}>
              {queue.items.map((item) => {
                const isRunningItem = item.status === 'running';
                const isCanceling = Boolean(cancelingTaskIds[item.id]);
                return (
                  <Box key={`${item.status}-${item.id}`} className={styles.queueItem}>
                    <Box className={styles.queueItemHeader}>
                      <Box className={styles.queueItemTitleWrapper}>
                        <Text className={styles.queueItemTitle}>
                          {item.promptSummary}
                        </Text>
                        <Text className={styles.queueItemId}>
                          #{item.id}
                        </Text>
                      </Box>
                      <Box
                        className={`${styles.queueItemStatusBadge} ${isRunningItem ? styles.running : styles.queued}`}
                      >
                        {isRunningItem ? t('queue.item.running') : t('queue.item.queued')}
                      </Box>
                    </Box>
                    {!isRunningItem && (
                      <Box className={styles.queueItemAction} style={{ alignSelf: 'flex-end' }}>
                        <MButton
                          onClick={() => { void handleCancelQueueTask(item.id); }}
                          disabled={isCanceling}
                          variant="light"
                          size="xs"
                          color="red"
                          leftSection={isCanceling ? <LoaderCircle size={12} /> : <X size={12} />}
                          styles={{
                            root: {
                              height: 24,
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 600,
                            },
                          }}
                        >
                          {isCanceling ? t('queue.canceling') : t('queue.cancel')}
                        </MButton>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Box>

      {!isMac && <WindowsControls t={t} />}
    </Flex>
  );
};
