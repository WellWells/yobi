import { Box, Loader, Text } from '@mantine/core';
import { Check, Circle, CircleSlash, X } from 'lucide-react';

export type ProgressState = 'done' | 'failed' | 'active' | 'skipped' | 'pending';

export const ROW_GAP = 6;
export const MARK_SLOT = 12;
export const NUMBER_WIDTH = 14;
export const LABEL_OFFSET = MARK_SLOT + ROW_GAP;
export const NUMBERED_MARK_OFFSET = NUMBER_WIDTH + ROW_GAP;
export const NUMBERED_LABEL_OFFSET = NUMBERED_MARK_OFFSET + LABEL_OFFSET;

export const PROGRESS_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: ROW_GAP, minWidth: 0 } as const;

const SLOT_STYLE = { flexShrink: 0, display: 'inline-flex', width: MARK_SLOT, justifyContent: 'center' } as const;

const NUMBER_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  width: NUMBER_WIDTH,
  textAlign: 'right',
  flexShrink: 0,
  fontVariantNumeric: 'tabular-nums',
} as const;

function MarkIcon({ state }: { state: ProgressState }) {
  if (state === 'done') return <Check size={11} color="var(--mantine-color-success)" />;
  if (state === 'failed') return <X size={11} color="var(--mantine-color-error)" />;
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

export function StepNumber({ value }: { value: number }) {
  return <Text component="span" style={NUMBER_STYLE}>{value}</Text>;
}
