import React, { useState } from 'react';
import { Badge, Box, Group, Loader, Stack, Text } from '@mantine/core';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { FlowDefinition } from '../../../../shared/types';

export interface FlowSidebarItemProps {
  flow: FlowDefinition;
  selected: boolean;
  isRunning: boolean;
  t: (k: string) => string;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleEnabled: (enabled: boolean) => void;
}

export const FlowSidebarItem: React.FC<FlowSidebarItemProps> = ({
  flow, selected, isRunning, t, onSelect, onContextMenu, onToggleEnabled,
}) => {
  const [hovered, setHovered] = useState(false);
  const bg = selected
    ? 'var(--mantine-color-accent-dim)'
    : hovered ? 'var(--mantine-color-bg-tertiary)' : 'var(--mantine-color-body)';
  const borderColor = selected
    ? 'var(--mantine-color-accent)'
    : 'var(--mantine-color-default-border)';

  return (
    <Box
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 10px',
        borderRadius: 10,
        margin: '4px 8px',
        background: bg,
        border: `1px solid ${borderColor}`,
        boxShadow: hovered ? '0 3px 10px rgba(0, 0, 0, 0.08)' : 'none',
        cursor: 'pointer',
        transition: 'background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" align="center">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text fz="var(--font-size-xs)" fw={500} lineClamp={1}>
            {flow.name || t('agentflow.flowName')}
          </Text>
          <Group gap={4}>
            <Badge size="xs" variant="light">{flow.trigger.type}</Badge>
            <Text fz="xs" c="dimmed">
              {flow.steps.length} {t('agentflow.steps').toLowerCase()}
            </Text>
          </Group>
        </Stack>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {isRunning && (
            <Box
              component="span"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Loader size={14} color="teal" />
            </Box>
          )}
          <ToggleSwitch
            size="xs"
            checked={flow.enabled}
            title={t('agentflow.enabled')}
            aria-label={t('agentflow.enabled')}
            onChange={(e) => {
              e.stopPropagation();
              onToggleEnabled(e.currentTarget.checked);
            }}
          />
        </Group>
      </Group>
    </Box>
  );
};
