import React from 'react';
import { ActionIcon, Box, Menu, Text, Tooltip } from '@mantine/core';
import { ChevronDown, ChevronRight, Copy, CornerLeftUp, EllipsisVertical, Trash, TriangleExclamationPoint } from 'lucide-react';
import { DangerMenuItem } from '../../../components/DangerMenuItem';
import { ProgressMark, type ProgressState } from '../../../components/ProgressMark';
import { SKILL_ICON } from '../skills';
import type { SkillType } from '../../../../../shared/types';
import { readFlowStepColor } from '../../../../../shared/flowStepColor';
import type { FlowStepColor } from '../../../../../shared/flowStepColor';
import { stepColorMark } from '../../../theme/flowStepColors';
import type { RowMatch } from './outlineModel';
import styles from './FlowOutline.module.css';

/** Steps deeper than this keep this indent and say their level instead. */
const MAX_INDENT_LEVEL = 3;
const INDENT_PX = 16;
/** Where the fold column starts: the row's left padding, the number column and the gap after it. */
const CONTENT_LEFT = 10 + 22 + 6;
/** The middle of a fold chevron: a block's line runs down from under its own chevron. */
const FOLD_MIDDLE = 7;

function guideLeft(level: number): number {
  return CONTENT_LEFT + level * INDENT_PX + FOLD_MIDDLE - 1;
}

export interface OutlineRowProps {
  id: string;
  index: number;
  type: SkillType;
  color?: FlowStepColor;
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

function MatchLine({ id, match, label }: { id: string; match: RowMatch; label: string }) {
  return (
    <Text id={id} fz={12} c="var(--text-muted)" lineClamp={1} style={{ wordBreak: 'break-all' }} aria-hidden>
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
    context, end, foldable, folded, tabbable, typeName, tooltip, levelLabel, t, onMenu, canDuplicate,
    canDelete, ownerTarget,
  } = props;
  const levels = Math.min(depth, MAX_INDENT_LEVEL);
  const indent = levels * INDENT_PX;
  // An end's own block line turns into it; deeper than the indent goes there is no line to turn.
  const corner = end && depth < MAX_INDENT_LEVEL && !context;
  const color = readFlowStepColor(props.color);
  const colorLabel = color ? ` · ${t('flow.step.color')}: ${t(`flow.step.color.${color}`)}` : '';
  const ids = React.useId();
  const numberId = `${ids}-number`;
  const nameId = `${ids}-name`;
  const summaryId = `${ids}-summary`;
  const unshownId = `${ids}-unshown`;
  const summaryShown = Boolean((match && matchLabel) || issue || secondary);
  return (
    <Box
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={foldable ? !folded : undefined}
      // Named by the number and name it shows, in that order (WCAG 2.5.3); the line under the name,
      // and the type and colour only drawn as an icon and a dot, describe it.
      aria-labelledby={`${numberId} ${nameId}`}
      aria-describedby={summaryShown ? `${summaryId} ${unshownId}` : unshownId}
      tabIndex={tabbable ? 0 : -1}
      data-outline-id={id}
      data-step-color={color}
      data-selected={selected ? 'true' : 'false'}
      data-context={context ? 'true' : undefined}
      data-end={end ? 'true' : undefined}
      className={styles.row}
    >
      {Array.from({ length: levels }).map((_, level) => (
        <Box key={level} className={styles.guide} style={{ left: guideLeft(level) }} aria-hidden data-outline-guide="" />
      ))}
      {corner && <Box className={styles.corner} style={{ left: guideLeft(depth) }} aria-hidden data-outline-corner="" />}
      <Text component="span" id={numberId} className={styles.number} aria-hidden>
        {levelLabel ? `${levelLabel} ` : ''}{String(index + 1).padStart(2, '0')}
      </Text>
      <Box component="span" className={styles.fold} style={{ marginLeft: indent }} data-outline-fold={foldable ? id : undefined} aria-hidden>
        {foldable && (folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
      </Box>
      <Tooltip label={tooltip} position="left" openDelay={500} multiline maw={300}>
        <Box className={styles.text}>
          <Box style={{ display: 'flex', gap: 6, minWidth: 0 }}>
            <Box component="span" className={styles.icon} aria-hidden>{SKILL_ICON[type]}</Box>
            {color && <Box component="span" w={8} h={8} mt={5} bg={stepColorMark(color)} style={{ borderRadius: '50%', flexShrink: 0 }} aria-hidden />}
            <Text id={nameId} fz="var(--font-size-base)" lh={1.4} lineClamp={1} c={end ? 'var(--text-muted)' : undefined} style={{ wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
              {primary}
            </Text>
          </Box>
          {/* The second line describes the row (aria-describedby still reads hidden nodes); hidden here
              so the visible text inside the treeitem matches its name (WCAG 2.5.3). */}
          {match && matchLabel ? <MatchLine id={summaryId} match={match} label={matchLabel} /> : issue ? (
            <Text id={summaryId} fz={12} c={issueTone === 'warning' ? 'var(--warning-text)' : 'var(--error-text)'} lineClamp={1} aria-hidden>{issue}</Text>
          ) : secondary ? (
            <Text id={summaryId} fz={12} c="var(--text-muted)" lineClamp={1} style={{ wordBreak: 'break-all' }} aria-hidden>{secondary}</Text>
          ) : null}
        </Box>
      </Tooltip>
      <span id={unshownId} hidden>{`${typeName}${colorLabel}${issue && match && matchLabel ? ` · ${issue}` : ''}`}</span>
      <Box component="span" className={styles.status} aria-label={issue ?? runLabel}>
        {issue
          ? <TriangleExclamationPoint size={12} color={issueTone === 'warning' ? 'var(--warning-text)' : 'var(--error-text)'} />
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
              <DangerMenuItem leftSection={<Trash size={14} />} onClick={() => onMenu('delete', id)}>{t('flow.step.delete')}</DangerMenuItem>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Box>
  );
});
OutlineRow.displayName = 'OutlineRow';
