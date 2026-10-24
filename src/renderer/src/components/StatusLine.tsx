import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { CheckCircle2, TriangleAlert, XCircle } from 'lucide-react';

export type StatusTone = 'success' | 'error' | 'warning';

const ICONS = { success: CheckCircle2, error: XCircle, warning: TriangleAlert } as const;
const ICON_COLOR = {
  success: 'var(--mantine-color-success)',
  error: 'var(--mantine-color-error)',
  warning: 'var(--mantine-color-warning)',
} as const;
const TEXT_COLOR = {
  ...ICON_COLOR,
  success: 'var(--text-muted)',
} as const;

const LINE_HEIGHT = 1.55;
// The icon sits in a box exactly one text line tall, so it centres on the first line however
// the message wraps. A bare svg inside a block box rides that box's own baseline instead,
// which lands it a few pixels below the text.
const ICON_SLOT_STYLE = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  height: `calc(var(--font-size-sm) * ${LINE_HEIGHT})`,
} as const;

/** One-line outcome under a form: a test result, a save error, a limit warning. */
export const StatusLine: React.FC<{ tone: StatusTone; children: React.ReactNode }> = ({ tone, children }) => {
  const Icon = ICONS[tone];
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" fz="var(--font-size-sm)" lh={LINE_HEIGHT}>
      <Box c={ICON_COLOR[tone]} style={ICON_SLOT_STYLE}><Icon size={14} /></Box>
      <Text inherit c={TEXT_COLOR[tone]}>{children}</Text>
    </Group>
  );
};
