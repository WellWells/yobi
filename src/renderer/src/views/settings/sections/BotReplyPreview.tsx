import React from 'react';
import { Box, Stack, Text } from '@mantine/core';

interface Props {
  /** What the platform does with the answer, under the bubble. */
  note: string;
  t: (key: string) => string;
}

const BUBBLE_STYLE = {
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 'var(--radius)',
  borderBottomLeftRadius: 4,
} as const;

/** A bot reply is the answer alone, on every platform. */
export const BotReplyPreview: React.FC<Props> = ({ note, t }) => (
  <Stack gap={6}>
    <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.telegram.preview.label')}</Text>
    <Box maw={360} p="8px 10px" bg="var(--mantine-color-default)" style={BUBBLE_STYLE}>
      <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" lh={1.6}>
        {t('settings.telegram.preview.answer')}
      </Text>
    </Box>
    <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{note}</Text>
  </Stack>
);
