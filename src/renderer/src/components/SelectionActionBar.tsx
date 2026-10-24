import React from 'react';
import { ActionIcon, Checkbox, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2, X } from 'lucide-react';
import { fillTemplate } from '../../../shared/fillTemplate';

interface SelectionActionBarProps {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  t: (key: string) => string;
  extraActions?: React.ReactNode;
  /** Labelled buttons share the row's width (default); icon buttons keep their size, left-aligned. */
  actionsGrow?: boolean;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  count, allSelected, onToggleAll, onDelete, onCancel, t, extraActions, actionsGrow = true,
}) => {
  const hasSelection = count > 0;
  const countLabel = hasSelection
    ? fillTemplate(t('selection.count'), { count: String(count) })
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

      {/* Delete sits beside the actions as an icon, never as the widest button on the bar:
          the most destructive choice should not also be the easiest one to hit. */}
      <Group gap={6} wrap="nowrap">
        <Group gap={6} grow={actionsGrow} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {extraActions}
        </Group>
        <Tooltip label={t('common.delete')} position="top">
          <ActionIcon
            size="input-xs"
            variant="light"
            color="red"
            disabled={!hasSelection}
            onClick={onDelete}
            aria-label={t('common.delete')}
            style={{ flexShrink: 0 }}
          >
            <Trash2 size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  );
};
