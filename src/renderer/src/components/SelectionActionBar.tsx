import React from 'react';
import { ActionIcon, Checkbox, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2, X } from 'lucide-react';
import { AppButton } from './AppButton';

interface SelectionActionBarProps {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  t: (key: string) => string;
  /** Type-specific bulk actions rendered before Delete (e.g. Enable/Disable for flows). */
  extraActions?: React.ReactNode;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  count, allSelected, onToggleAll, onDelete, onCancel, t, extraActions,
}) => {
  const hasSelection = count > 0;
  const countLabel = hasSelection
    ? t('selection.count').replace('{{count}}', String(count))
    : t('selection.selectAll');

  return (
    <Stack
      gap={8}
      p="8px 12px"
      bg="var(--mantine-color-default)"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
    >
      <Group justify="space-between" wrap="nowrap" gap={8}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Checkbox
            size="xs"
            checked={allSelected}
            indeterminate={hasSelection && !allSelected}
            onChange={onToggleAll}
            aria-label={t('selection.selectAll')}
          />
          <Text
            fz="var(--font-size-xs)"
            c="dimmed"
            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {countLabel}
          </Text>
        </Group>
        <Tooltip label={t('selection.exit')} position="top">
          <ActionIcon
            variant="subtle"
            size="sm"
            c="dimmed"
            onClick={onCancel}
            aria-label={t('selection.exit')}
            style={{ flexShrink: 0 }}
          >
            <X size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Group gap={6} grow wrap="nowrap">
        {extraActions}
        <AppButton
          size="xs"
          variant="light"
          color="red"
          leftSection={<Trash2 size={13} />}
          disabled={!hasSelection}
          onClick={onDelete}
        >
          {t('common.delete')}
        </AppButton>
      </Group>
    </Stack>
  );
};
