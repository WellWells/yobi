import React from 'react';
import { Badge, Box, Checkbox, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { FlowDefinition } from '../../../../shared/types';
import styles from './FlowSidebarItem.module.css';

export interface FlowSidebarItemProps {
  flow: FlowDefinition;
  selected: boolean;
  isRunning: boolean;
  t: (k: string) => string;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onRowClick: (mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleEnabled: (enabled: boolean) => void;
}

export const FlowSidebarItem: React.FC<FlowSidebarItemProps> = ({
  flow, selected, isRunning, t, selectMode, checked, onToggleSelect,
  onRowClick, onContextMenu, onToggleEnabled,
}) => {
  return (
    <Box
      className={styles.row}
      data-selected={(selectMode ? checked : selected) ? 'true' : undefined}
      onClick={(e) => onRowClick({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })}
      onContextMenu={selectMode ? undefined : onContextMenu}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" align="center">
        {selectMode && (
          <Checkbox
            size="xs"
            checked={checked}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={flow.name || t('agentflow.flowName')}
            style={{ flexShrink: 0 }}
          />
        )}
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text fz="var(--font-size-xs)" fw={500} lineClamp={1}>
            {flow.name || t('agentflow.flowName')}
          </Text>
          <Group gap={4}>
            <Badge size="xs" variant="light">{t(`agentflow.trigger.${flow.trigger.type}`)}</Badge>
            {flow.extraTriggers && flow.extraTriggers.length > 0 && (
              <Badge size="xs" variant="light" color="gray">{`+${flow.extraTriggers.length}`}</Badge>
            )}
            <Text fz="xs" c="dimmed">
              {flow.steps.length} {t('agentflow.steps').toLowerCase()}
            </Text>
          </Group>
        </Stack>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {isRunning && (
            <Box component="span" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader size={14} color="teal" />
            </Box>
          )}
          <Box component="span" style={{ display: 'inline-flex' }} onPointerDown={(e) => e.stopPropagation()}>
            <Tooltip label={t('agentflow.enabled')} position="top">
              <Box component="span" style={{ display: 'inline-flex' }}>
                <ToggleSwitch
                  size="xs"
                  checked={flow.enabled}
                  aria-label={t('agentflow.enabled')}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleEnabled(e.currentTarget.checked);
                  }}
                />
              </Box>
            </Tooltip>
          </Box>
        </Group>
      </Group>
    </Box>
  );
};
