import React from 'react';
import { ActionIcon, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { FolderOpen, Square, X } from 'lucide-react';
import { AppButton } from '../AppButton';
import { fileApi } from '../../api/electronApi';
import type { BatchExportState } from './useBatchExport';
import { fillTemplate } from '../../../../shared/fillTemplate';

interface BatchExportStripProps {
  state: BatchExportState;
  onStop: () => void;
  onDismiss: () => void;
  t: (key: string) => string;
}

const LEVEL_COLOR = {
  success: 'var(--mantine-color-success)',
  warning: 'var(--mantine-color-warning)',
  error: 'var(--mantine-color-error)',
} as const;

const MAX_LISTED = 3;

/** Where a batch export reports itself: progress with a Stop button, then what happened. */
export const BatchExportStrip: React.FC<BatchExportStripProps> = ({ state, onStop, onDismiss, t }) => {
  if (state.phase === 'idle') return null;

  if (state.phase === 'running') {
    const percent = state.total > 0 ? (state.done / state.total) * 100 : 0;
    return (
      <Stack
        gap={8}
        p="8px 12px"
        bg="var(--mantine-color-default)"
        style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        <Group justify="space-between" wrap="nowrap" gap={8}>
          <Text fz="var(--font-size-xs)" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {fillTemplate(t('batchExport.progress'), { done: String(state.done), total: String(state.total) })}
          </Text>
          <AppButton
            size="xs"
            variant="default"
            leftSection={<Square size={11} />}
            loading={state.stopping}
            onClick={onStop}
          >
            {t(state.stopping ? 'batchExport.stopping' : 'batchExport.stop')}
          </AppButton>
        </Group>
        <Progress size="xs" value={percent} animated={state.done === 0} aria-label={t('batchExport.progressLabel')} />
      </Stack>
    );
  }

  const listed = state.details.slice(0, MAX_LISTED);
  const more = state.details.length - listed.length;
  const { reveal } = state;
  return (
    <Stack
      gap={6}
      p="8px 12px"
      bg="var(--mantine-color-default)"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
    >
      <Group justify="space-between" wrap="nowrap" gap={8} align="flex-start">
        <Text fz="var(--font-size-xs)" c={LEVEL_COLOR[state.level]} style={{ minWidth: 0 }}>
          {state.message}
        </Text>
        <Tooltip label={t('batchExport.dismiss')} position="top">
          <ActionIcon variant="subtle" size="sm" c="dimmed" onClick={onDismiss} aria-label={t('batchExport.dismiss')} style={{ flexShrink: 0 }}>
            <X size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {listed.length > 0 && (
        <Stack gap={2}>
          {listed.map((name, idx) => (
            <Text key={`${idx}:${name}`} fz="var(--font-size-xs)" c="var(--text-muted)" truncate>
              {name}
            </Text>
          ))}
          {more > 0 && (
            <Text fz="var(--font-size-xs)" c="var(--text-muted)">
              {fillTemplate(t('batchExport.more'), { count: String(more) })}
            </Text>
          )}
        </Stack>
      )}
      {reveal && (
        <Group>
          <AppButton
            size="xs"
            variant="subtle"
            px={6}
            leftSection={<FolderOpen size={13} />}
            onClick={() => { void (reveal.kind === 'folder' ? fileApi.openPath(reveal.path) : fileApi.showInFolder(reveal.path)); }}
          >
            {t('batchExport.showFolder')}
          </AppButton>
        </Group>
      )}
    </Stack>
  );
};
