import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { FileText } from 'lucide-react';
import type { TelegramReplyMode } from '../../../../../shared/types';

interface Props {
  compactReply: boolean;
  mode: TelegramReplyMode;
  /** Overrides the note under the bubble — LINE always replies compact for its own reasons. */
  note?: string;
  t: (key: string) => string;
}

const BUBBLE_STYLE = {
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 'var(--radius-md)',
  borderBottomLeftRadius: 4,
} as const;

const PSEUDO_BUTTON_STYLE = {
  border: '1px solid var(--mantine-color-default-border)',
  borderRadius: 'var(--radius-sm)',
  pointerEvents: 'none',
} as const;

const PseudoButton: React.FC<{ label: string }> = ({ label }) => (
  <Box flex={1} p="4px 6px" bg="var(--mantine-color-bg-tertiary)" style={PSEUDO_BUTTON_STYLE}>
    <Text fz="var(--font-size-sm)" c="var(--mantine-color-accent)" ta="center">{label}</Text>
  </Box>
);

export const BotReplyPreview: React.FC<Props> = ({ compactReply, mode, note, t }) => {
  const isDocument = !compactReply && mode !== 'markdown';
  const derivedNote = compactReply
    ? t('settings.telegram.preview.note.compact')
    : (isDocument ? t('settings.telegram.preview.note.file') : t('settings.telegram.preview.note.markdown'));

  return (
    <Stack gap={6}>
      <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.telegram.preview.label')}</Text>
      <Box maw={360} p="8px 10px" bg="var(--mantine-color-bg-secondary)" style={BUBBLE_STYLE}>
        {isDocument ? (
          <Group gap={8} align="center" wrap="nowrap">
            <FileText size={22} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" ff="var(--font-mono)" truncate>
                {t('settings.telegram.preview.fileName')}.{mode}
              </Text>
              <Text fz="var(--font-size-sm)" c="dimmed">
                {t('settings.telegram.preview.docCaption')} · {mode.toUpperCase()}
              </Text>
            </Stack>
          </Group>
        ) : (
          <Stack gap={6}>
            {!compactReply && (
              <Stack gap={2}>
                <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">
                  {t('settings.telegram.preview.completed')}
                </Text>
                <Text fz="var(--font-size-sm)" c="dimmed">
                  {t('settings.telegram.preview.saved')}
                </Text>
              </Stack>
            )}
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" lh={1.6}>
              {t('settings.telegram.preview.answer')}
            </Text>
            {!compactReply && (
              <Stack gap={4}>
                <Group gap={4} wrap="nowrap">
                  <PseudoButton label={t('telegram.msg.downloadPng')} />
                  <PseudoButton label={t('telegram.msg.downloadWebp')} />
                </Group>
                <PseudoButton label={t('telegram.msg.downloadPdf')} />
              </Stack>
            )}
          </Stack>
        )}
      </Box>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{note ?? derivedNote}</Text>
    </Stack>
  );
};
