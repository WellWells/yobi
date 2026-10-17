import React from 'react';
import { Anchor, Group, Loader, Text, Tooltip } from '@mantine/core';
import { Check, CircleAlert, CloudOff } from 'lucide-react';
import { useFormatTime } from '../../hooks/useFormatTime';
import { useAppStore } from '../../store/appStore';
import type { SyncLine } from './documentSync';

/** The header's one line about the document and Notion: synced, sending, waiting, or why not. */
export const SyncStatusLabel: React.FC<{ line: SyncLine | null; t: (key: string) => string }> = ({ line, t }) => {
  const formatTime = useFormatTime();
  if (!line) return null;
  const text = (key: string, color: string, icon: React.ReactNode, tooltip?: string): React.ReactElement => (
    <Tooltip label={tooltip ?? ''} disabled={!tooltip} position="bottom">
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        {icon}
        <Text fz="var(--font-size-xs)" c={color} style={{ whiteSpace: 'nowrap' }}>{key}</Text>
      </Group>
    </Tooltip>
  );
  switch (line.kind) {
    case 'busy':
      return text(t('notion.status.busy'), 'var(--text-muted)', <Loader size={10} color="var(--text-muted)" />);
    case 'notConnected':
      return (
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <CloudOff size={12} color="var(--mantine-color-warning)" />
          <Text fz="var(--font-size-xs)" c="var(--mantine-color-warning)" style={{ whiteSpace: 'nowrap' }}>
            {t('notion.status.notConnected')}
          </Text>
          <Anchor component="button" fz="var(--font-size-xs)" onClick={() => useAppStore.getState().openSettingsCategory('connectors')}>
            {t('notion.status.openSettings')}
          </Anchor>
        </Group>
      );
    case 'conflicts':
      return text(t('notion.status.conflicts').replace('{{count}}', String(line.count)), 'var(--mantine-color-warning)', <CircleAlert size={12} color="var(--mantine-color-warning)" />);
    case 'locked':
      return text(
        t('notion.status.locked').replace('{{count}}', String(line.count)),
        'var(--mantine-color-warning)',
        <CircleAlert size={12} color="var(--mantine-color-warning)" />,
        t('notion.sync.lockedReason'),
      );
    case 'error':
      return text(t(`notion.error.${line.error}`), 'var(--mantine-color-error)', <CircleAlert size={12} color="var(--mantine-color-error)" />);
    case 'unsynced':
      return text(t('notion.status.unsynced'), 'var(--mantine-color-warning)', <CircleAlert size={12} color="var(--mantine-color-warning)" />);
    case 'synced':
      return text(
        line.at ? t('notion.status.syncedAt').replace('{{time}}', formatTime(line.at)) : t('notion.status.synced'),
        'var(--text-muted)',
        <Check size={12} color="var(--mantine-color-success)" />,
      );
    default:
      return null;
  }
};
