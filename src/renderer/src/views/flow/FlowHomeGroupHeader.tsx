import React from 'react';
import { Group, Text, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronRight, Play, Square } from 'lucide-react';
import { ToolbarIconButton } from '../../components/PanelToolbar';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { FlowFolderRunState } from '../../../../shared/flowFolderRun';
import { FlowAttentionMark } from './FlowAttentionMark';
import type { FlowAttention } from './flowSidebarRows';
import classes from './FlowHome.module.css';

interface FlowHomeGroupHeaderProps {
  label: string;
  count: number;
  open: boolean;
  /** What the closed group hides: its flows' warnings and runs (the sidebar's closed folder). */
  attention: FlowAttention;
  /** Its 「全部執行」 batch, while one runs. */
  run: FlowFolderRunState | null;
  t: (key: string) => string;
  onToggle: () => void;
  /** Unset for 未分類: only a category runs as one. */
  onRun?: () => void;
  onStop?: () => void;
}

/**
 * A category on the flow home: its name opens and closes it; on the right, 「全部執行」, which
 * becomes the stop with how far it got while the category runs.
 */
export const FlowHomeGroupHeader: React.FC<FlowHomeGroupHeaderProps> = ({
  label, count, open, attention, run, t, onToggle, onRun, onStop,
}) => {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" h={30}>
      <UnstyledButton className={classes.groupToggle} onClick={onToggle} aria-expanded={open}>
        <Chevron size={14} aria-hidden />
        <Text component="span" fz="var(--font-size-sm)" fw={600} c="inherit" truncate>{label}</Text>
        <Text component="span" fz="xs" c="var(--text-muted)" ml={4} style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</Text>
      </UnstyledButton>
      <Group gap={6} wrap="nowrap">
        {!open && <FlowAttentionMark {...attention} t={t} />}
        {run && onStop ? (
          <>
            <Text fz="xs" c="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {`${run.done}/${run.flowIds.length}`}
            </Text>
            <ToolbarIconButton
              icon={Square}
              label={fillTemplate(t('flow.folder.run.stop'), { done: String(run.done), total: String(run.flowIds.length) })}
              onClick={onStop}
            />
          </>
        ) : onRun && (
          <ToolbarIconButton icon={Play} label={t('flow.folder.runAll')} onClick={onRun} />
        )}
      </Group>
    </Group>
  );
};
