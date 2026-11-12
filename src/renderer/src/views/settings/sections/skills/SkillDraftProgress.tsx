import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { ElapsedTime } from '../../../../components/ElapsedTime';
import { PROGRESS_ROW_STYLE, ProgressMark } from '../../../../components/ProgressMark';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import type { SkillDraftCallPurpose } from '../../../../../../shared/skillAuthoring';
import { draftEndedClean } from './skillDraftProgressModel';
import type { DraftProgress, DraftRow } from './skillDraftProgressModel';

type T = (key: string) => string;

const CALL_LABEL: Record<SkillDraftCallPurpose, string> = {
  write: 'settings.skills.progress.write',
  conversation: 'settings.skills.progress.conversation',
  revise: 'settings.skills.progress.revise',
  answers: 'settings.skills.progress.answers',
  reformat: 'settings.skills.progress.reformat',
};

const TEXT_STYLE = { fontSize: 'var(--font-size-sm)', lineHeight: 1.5 } as const;
const TRAILING_STYLE = { ...TEXT_STYLE, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' } as const;

export function draftRowLabel(row: DraftRow, t: T): string {
  switch (row.kind) {
    case 'model':
      return t(CALL_LABEL[row.purpose]);
    case 'unusable':
      return t('settings.skills.progress.unusable');
    case 'lint':
      return row.errors ? fillTemplate(t('settings.skills.progress.lintFailed'), { count: String(row.errors) }) : t('settings.skills.progress.lint');
    case 'runs': {
      if (row.total === undefined) return t('settings.skills.progress.runs');
      const total = String(row.total);
      if (row.status === 'active') return fillTemplate(t('settings.skills.progress.runsRunning'), { done: String(row.done ?? 0), total });
      return fillTemplate(t('settings.skills.progress.runsDone'), { passed: String(row.total - (row.failed ?? 0)), total });
    }
    case 'stopped':
      return t('settings.skills.progress.stopped');
  }
}

/** After a model row's label: how long the call has taken and, from the second call on, how many of the budget. */
const CallTrailing: React.FC<{ row: Extract<DraftRow, { kind: 'model' }>; t: T }> = ({ row, t }) => (
  <>
    <Text component="span" style={TRAILING_STYLE}>
      {row.status === 'active'
        ? <ElapsedTime startedAt={row.startedAt} />
        : <ElapsedTime durationMs={(row.endedAt ?? row.startedAt) - row.startedAt} />}
    </Text>
    {row.call > 1 && (
      <Text component="span" style={TRAILING_STYLE}>
        {fillTemplate(t('settings.skills.progress.call'), { call: String(row.call), budget: String(row.budget) })}
      </Text>
    )}
  </>
);

const Row: React.FC<{ row: DraftRow; t: T }> = ({ row, t }) => (
  <Box style={PROGRESS_ROW_STYLE} data-draft-row={row.kind} data-draft-status={row.status}>
    <ProgressMark state={row.status} />
    <Text
      component="span"
      style={{ ...TEXT_STYLE, minWidth: 0, color: row.status === 'pending' ? 'var(--mantine-color-dimmed)' : undefined }}
    >
      {draftRowLabel(row, t)}
    </Text>
    {row.kind === 'model' && <CallTrailing row={row} t={t} />}
  </Box>
);

/**
 * What a draft is doing while the user waits: each model call with its seconds, then the checks on
 * this computer, example run by example run. A draft whose last round passed shrinks to one line; one that failed
 * or was stopped keeps the list. Gone while the questions are asked.
 */
export const SkillDraftProgress: React.FC<{ progress: DraftProgress | null; t: T }> = ({ progress, t }) => {
  if (!progress || progress.outcome === 'questions' || progress.rows.length === 0) return null;
  if (draftEndedClean(progress)) {
    return (
      <Box style={PROGRESS_ROW_STYLE} role="status" data-draft-row="done" data-draft-status="done">
        <ProgressMark state="done" />
        <Text component="span" style={TEXT_STYLE}>{t('settings.skills.progress.done')}</Text>
        <Text component="span" style={TRAILING_STYLE}>
          <ElapsedTime durationMs={(progress.endedAt ?? progress.startedAt) - progress.startedAt} />
        </Text>
      </Box>
    );
  }
  return (
    <Stack gap={4} role="status" aria-live="polite">
      {progress.rows.map((row, index) => (
        // A listed row keeps its place (a waiting one is replaced where it stood), so the position is its identity.
        <Row key={`${index}-${row.kind}`} row={row} t={t} />
      ))}
    </Stack>
  );
};
