import React, { useRef } from 'react';
import { Badge, Box, Checkbox, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { RowMoreButton } from '../../components/RowMoreButton';
import type { MenuAnchor } from '../../components/RowMoreButton';
import { SwipeRow } from '../../components/SwipeRow';
import { menuAnchorUnderRow, swipeAnchorElement } from '../../utils/rowSwipe';
import { flowTrailingActions } from '../../utils/rowSwipeActions';
import type { FlowDefinition } from '../../../../shared/types';
import type { FlowIssue } from '../../../../shared/flowIssues';
import { describeFlowIssue } from './flowIssueText';
import styles from './FlowSidebarItem.module.css';

export interface FlowSidebarItemProps {
  flow: FlowDefinition;
  selected: boolean;
  isRunning: boolean;
  issues: FlowIssue[];
  t: (k: string) => string;
  selectMode: boolean;
  checked: boolean;
  onToggleSelect: () => void;
  onRowClick: (mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** The hover "⋯" button and the swipe's "More": the same menu as a right-click, at a point. */
  onOpenMenuAt: (at: MenuAnchor) => void;
  /** This row's menu is open (the "⋯" stays visible). */
  menuOpen: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  /** The context menu's delete path (asks first). */
  onDelete: () => void;
}

function issueId(issue: FlowIssue): string {
  return `${issue.kind} ${issue.scope ?? ''} ${issue.command ?? ''}`;
}

export const FlowSidebarItem: React.FC<FlowSidebarItemProps> = ({
  flow, selected, isRunning, issues, t, selectMode, checked, onToggleSelect,
  onRowClick, onContextMenu, onOpenMenuAt, menuOpen, onToggleEnabled, onDelete,
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  // Left swipe (macOS): More, Delete. Right is reserved for pin.
  const trailing = flowTrailingActions({ more: t('rowSwipe.more'), delete: t('common.delete') }, {
    onMore: () => {
      const row = rowRef.current;
      if (row) onOpenMenuAt(menuAnchorUnderRow(swipeAnchorElement(row).getBoundingClientRect()));
    },
    onDelete,
  });
  return (
    // The frame carries the row's margin so the swipe layer covers exactly the rounded row.
    <Box className={styles.frame}>
    <SwipeRow trailing={trailing} disabled={selectMode}>
    <Box
      ref={rowRef}
      className={styles.row}
      data-flow-id={flow.id}
      data-selected={(selectMode ? checked : selected) ? 'true' : undefined}
      data-menu-open={menuOpen || undefined}
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
            aria-label={flow.name || t('flow.flowName')}
            style={{ flexShrink: 0 }}
          />
        )}
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text fz="var(--font-size-sm)" fw={500} lineClamp={1}>
            {flow.name || t('flow.flowName')}
          </Text>
          <Group gap={4}>
            <Badge size="xs" variant="light">{t(`flow.trigger.${flow.trigger.type}`)}</Badge>
            {flow.extraTriggers && flow.extraTriggers.length > 0 && (
              <Badge size="xs" variant="light" color="gray">{`+${flow.extraTriggers.length}`}</Badge>
            )}
            <Text fz="var(--font-size-xs)" c="dimmed">
              {flow.steps.length} {t('flow.steps').toLowerCase()}
            </Text>
          </Group>
        </Stack>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {/* Before the switch, so the switch ends the row and the hidden slot sits after the name. */}
          {!selectMode && (
            <RowMoreButton
              label={t('common.moreActions')}
              menuOpen={menuOpen}
              onOpen={onOpenMenuAt}
              className={styles.rowMore}
            />
          )}
          {issues.length > 0 && (
            <Tooltip
              position="top"
              maw={280}
              multiline
              label={(
                <Stack gap={4}>
                  {issues.map((issue) => (
                    <Text key={issueId(issue)} fz="xs" lh={1.5}>{describeFlowIssue(issue, t)}</Text>
                  ))}
                </Stack>
              )}
            >
              {/* A tooltip is mouse-only, so the reasons have to reach the label too. */}
              <Box
                component="span"
                role="img"
                aria-label={issues.map((issue) => describeFlowIssue(issue, t)).join(' ')}
                style={{ display: 'inline-flex' }}
              >
                <TriangleAlert size={13} color="var(--mantine-color-warning)" />
              </Box>
            </Tooltip>
          )}
          {isRunning && (
            <Box component="span" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader size={14} />
            </Box>
          )}
          <Box component="span" style={{ display: 'inline-flex' }} onPointerDown={(e) => e.stopPropagation()}>
            <Tooltip label={t('flow.enabled')} position="top">
              <Box component="span" style={{ display: 'inline-flex' }}>
                <ToggleSwitch
                  size="xs"
                  checked={flow.enabled}
                  aria-label={t('flow.enabled')}
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
    </SwipeRow>
    </Box>
  );
};
