import React from 'react';
import { ActionIcon, Box, Menu, Text, Tooltip } from '@mantine/core';
import { ChevronDown, ChevronRight, Copy, CornerLeftUp, EllipsisVertical, Trash, TriangleExclamationPoint } from 'lucide-react';
import { ProgressMark, type ProgressState } from '../../../components/ProgressMark';
import { SKILL_ICON } from '../skills';
import type { SkillType } from '../../../../../shared/types';
import type { RowMatch } from './outlineModel';
import styles from './FlowOutline.module.css';

/** Steps deeper than this keep this indent and say their level instead. */
const MAX_INDENT_LEVEL = 3;
const INDENT_PX = 12;

export interface OutlineRowProps {
  id: string;
  index: number;
  type: SkillType;
  depth: number;
  primary: string;
  secondary?: string;
  /** A search hit, said in place of the second line. */
  match?: RowMatch;
  matchLabel?: string;
  issue?: string;
  issueTone?: 'error' | 'warning';
  runState?: ProgressState;
  runLabel?: string;
  selected: boolean;
  inView: boolean;
  /** Shown only as the place a search hit sits. */
  context: boolean;
  end: boolean;
  /** A loop, condition or comment section: whether it has rows to fold, and whether they are. */
  foldable: boolean;
  folded: boolean;
  tabbable: boolean;
  typeName: string;
  tooltip: string;
  /** "L5" for a step deeper than the indent goes. */
  levelLabel?: string;
  t: (key: string) => string;
  onMenu: (action: 'duplicate' | 'delete' | 'owner', id: string) => void;
  canDuplicate: boolean;
  canDelete: boolean;
  ownerTarget?: boolean;
}

function MatchLine({ match, label }: { match: RowMatch; label: string }) {
  return (
    <Text fz={12} c="var(--text-muted)" lineClamp={1} style={{ wordBreak: 'break-all' }}>
      {label}
      {match.hit && '：'}
      {match.before}
      {match.hit && <Text component="span" fz={12} fw={700} c="var(--mantine-color-default-color)">{match.hit}</Text>}
      {match.after}
    </Text>
  );
}

/** One step in the outline. Every prop is a primitive, so an edit redraws only the rows it changed. */
export const OutlineRow: React.FC<OutlineRowProps> = React.memo((props) => {
  const {
    id, index, type, depth, primary, secondary, match, matchLabel, issue, issueTone, runState, runLabel, selected,
    inView, context, end, foldable, folded, tabbable, typeName, tooltip, levelLabel, t, onMenu, canDuplicate,
    canDelete, ownerTarget,
  } = props;
  const indent = Math.min(depth, MAX_INDENT_LEVEL) * INDENT_PX;
  return (
    <Box
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={foldable ? !folded : undefined}
      aria-label={`${String(index + 1).padStart(2, '0')} ${typeName} ${primary}${issue ? ` · ${issue}` : ''}`}
      tabIndex={tabbable ? 0 : -1}
      data-outline-id={id}
      data-selected={selected ? 'true' : 'false'}
      data-context={context ? 'true' : undefined}
      data-end={end ? 'true' : undefined}
      className={styles.row}
      style={{ paddingLeft: 10 + indent }}
    >
      {inView && <Box className={styles.rail} aria-hidden />}
      <Text component="span" className={styles.number} aria-hidden>
        {levelLabel ? `${levelLabel} ` : ''}{String(index + 1).padStart(2, '0')}
      </Text>
      <Box component="span" className={styles.fold} data-outline-fold={foldable ? id : undefined} aria-hidden>
        {foldable && (folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
      </Box>
      <Tooltip label={tooltip} position="left" openDelay={500} multiline maw={300}>
        <Box className={styles.text}>
          <Box style={{ display: 'flex', gap: 6, minWidth: 0 }}>
            <Box component="span" className={styles.icon} aria-hidden>{SKILL_ICON[type]}</Box>
            <Text fz={13} lh="18px" lineClamp={1} c={end ? 'var(--text-muted)' : undefined} style={{ wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
              {primary}
            </Text>
          </Box>
          {match && matchLabel ? <MatchLine match={match} label={matchLabel} /> : issue ? (
            <Text fz={12} c={issueTone === 'warning' ? 'var(--mantine-color-warning)' : 'var(--mantine-color-error)'} lineClamp={1}>{issue}</Text>
          ) : secondary ? (
            <Text fz={12} c="var(--text-muted)" lineClamp={1} style={{ wordBreak: 'break-all' }}>{secondary}</Text>
          ) : null}
        </Box>
      </Tooltip>
      <Box component="span" className={styles.status} aria-label={issue ?? runLabel}>
        {issue
          ? <TriangleExclamationPoint size={12} color={issueTone === 'warning' ? 'var(--mantine-color-warning)' : 'var(--mantine-color-error)'} />
          : runState && <ProgressMark state={runState} />}
      </Box>
      {!context && (
        <Menu position="bottom-end" withinPortal shadow="md">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size={18}
              className={styles.more}
              aria-label={t('common.moreActions')}
              tabIndex={-1}
              data-outline-more=""
            >
              <EllipsisVertical size={12} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {ownerTarget && (
              <Menu.Item leftSection={<CornerLeftUp size={14} />} onClick={() => onMenu('owner', id)}>
                {t('flow.outline.goToStart')}
              </Menu.Item>
            )}
            {canDuplicate && (
              <Menu.Item leftSection={<Copy size={14} />} onClick={() => onMenu('duplicate', id)}>{t('flow.step.duplicate')}</Menu.Item>
            )}
            {canDelete && (
              <Menu.Item leftSection={<Trash size={14} />} color="red" onClick={() => onMenu('delete', id)}>{t('flow.step.delete')}</Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Box>
  );
});
OutlineRow.displayName = 'OutlineRow';
