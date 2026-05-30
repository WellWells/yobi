// src/renderer/src/components/LogPanel.tsx
import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Button, Flex, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { PanelHeader } from './PanelHeader';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Info, ScrollText, Trash2, Zap } from 'lucide-react';
import styles from './LogPanel.module.css';

type LogLevel = 'error' | 'success' | 'warning' | 'active' | 'info';

function classifyLog(msg: string): LogLevel {
  if (msg.includes('❌') || msg.includes('Error') || msg.includes('failed')) return 'error';
  if (msg.includes('✅') || msg.includes('💾') || msg.includes('📋')) return 'success';
  if (msg.includes('⚠️') || msg.includes('Warning')) return 'warning';
  if (msg.includes('⏳') || msg.includes('📤') || msg.includes('🔥') || msg.includes('⌨️')) return 'active';
  return 'info';
}

const levelColorMap: Record<LogLevel, string> = {
  error: 'var(--mantine-color-error)',
  success: 'var(--mantine-color-success)',
  warning: 'var(--mantine-color-warning)',
  active: 'var(--mantine-color-accent)',
  info: 'var(--mantine-color-dimmed)',
};

const LevelIcon: React.FC<{ level: LogLevel }> = ({ level }) => {
  const size = 11;
  const color = levelColorMap[level];
  switch (level) {
    case 'error': return <Box component="span" mt={2} style={{ flexShrink: 0 }}><AlertCircle size={size} color={color} /></Box>;
    case 'success': return <Box component="span" mt={2} style={{ flexShrink: 0 }}><CheckCircle2 size={size} color={color} /></Box>;
    case 'warning': return <Box component="span" mt={2} style={{ flexShrink: 0 }}><AlertTriangle size={size} color={color} /></Box>;
    case 'active': return <Box component="span" mt={2} style={{ flexShrink: 0 }}><Zap size={size} color={color} /></Box>;
    default: return <Box component="span" mt={2} style={{ flexShrink: 0 }}><Info size={size} color={color} /></Box>;
  }
};

const LogEntry = React.memo<{ log: string; index: number }>(({ log, index }) => {
  const level = classifyLog(log);
  return (
    <Flex
      className={`${styles.logEntry} ${index % 2 !== 0 ? styles.odd : styles.even}`}
      align="flex-start"
      gap={7}
      px={6}
      py={3}
    >
      <LevelIcon level={level} />
      <Text
        component="span"
        size="sm"
        c={levelColorMap[level]}
        lh={1.6}
        className={styles.logText}
      >
        {log}
      </Text>
    </Flex>
  );
});

export const LogPanel: React.FC = () => {
  const { logs, clearLogs } = useAppStore();
  const { t } = useI18nStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const handleClear = useCallback(() => clearLogs(), [clearLogs]);

  const handleExport = useCallback(() => {
    const content = logs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `dac-logs-${now}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 26,
    overscan: 15,
  });

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight <= 100;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (!isNearBottomRef.current || logs.length === 0) return;
    rowVirtualizer.scrollToIndex(logs.length - 1, { align: 'end' });
  }, [logs.length, rowVirtualizer]);

  return (
    <Stack gap={0} h="100%" style={{ overflow: 'hidden' }}>
      <PanelHeader
        label={t('nav.logs')}
        icon={<ScrollText size={13} />}
        px={16}
        py={8}
        rightSection={(
          <Group gap={8} wrap="nowrap">
            <Text fz="var(--font-size-sm)" c="dimmed">{logs.length} {t('log.entries')}</Text>
            <Button variant="default" size="compact-xs" onClick={handleClear} leftSection={<Trash2 size={11} />}>
              {t('log.clear')}
            </Button>
            <Button
              variant="default"
              size="compact-xs"
              onClick={handleExport}
              disabled={logs.length === 0}
              leftSection={<Download size={11} />}
            >
              {t('log.export')}
            </Button>
          </Group>
        )}
      />

      <ScrollArea
        flex={1}
        viewportRef={viewportRef}
        bg="var(--mantine-color-body)"
        px={14}
        py={10}
        ff="var(--font-mono)"
        fz="var(--font-size-sm)"
      >
        {logs.length === 0 ? (
          <Stack align="center" justify="center" gap={8} pt={40} c="dimmed" opacity={0.6}>
            <ScrollText size={28} />
            <Text fz="var(--font-size-base)">{t('log.empty')}</Text>
          </Stack>
        ) : (
          <Box style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <Box
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <LogEntry log={logs[virtualRow.index]} index={virtualRow.index} />
              </Box>
            ))}
          </Box>
        )}
      </ScrollArea>
    </Stack>
  );
};

