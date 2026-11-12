import { Box, Loader } from '@mantine/core';
import { Check, Circle, CircleSlash, CircleX, X } from 'lucide-react';

/** `softFailed`: the step failed and the flow went on (its "continue on failure" switch). */
export type ProgressState = 'done' | 'failed' | 'softFailed' | 'active' | 'skipped' | 'pending';

export const ROW_GAP = 6;
export const MARK_SLOT = 12;
export const LABEL_OFFSET = MARK_SLOT + ROW_GAP;

export const PROGRESS_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: ROW_GAP, minWidth: 0 } as const;

const SLOT_STYLE = { flexShrink: 0, display: 'inline-flex', width: MARK_SLOT, justifyContent: 'center' } as const;

function MarkIcon({ state }: { state: ProgressState }) {
  if (state === 'done') return <Check size={11} color="var(--mantine-color-success)" />;
  if (state === 'failed') return <X size={11} color="var(--mantine-color-error)" />;
  if (state === 'softFailed') return <CircleX size={11} color="var(--mantine-color-warning)" />;
  if (state === 'active') return <Loader size={10} />;
  if (state === 'skipped') return <CircleSlash size={10} color="var(--mantine-color-dimmed)" />;
  return <Circle size={9} color="var(--mantine-color-dimmed)" />;
}

/** The status column every progress list shares, so a label never moves when its status changes. */
export function ProgressMark({ state }: { state: ProgressState }) {
  return (
    <Box component="span" data-progress-mark={state} style={SLOT_STYLE}>
      <MarkIcon state={state} />
    </Box>
  );
}
