import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { AppButton } from '../../../../components/AppButton';
import { TextDiffView } from '../../../../components/history/TextDiffView';
import type { SkillTextFiles } from '../../../../../../shared/skillAuthoring';

interface Props {
  current: SkillTextFiles;
  draft: SkillTextFiles;
  changed: readonly string[];
  onApply: () => void;
  onDiscard: () => void;
  t: (key: string) => string;
}

/** A draft over files the user had typed: each changed file as a diff, applied or discarded as one. */
export const SkillDraftDiff: React.FC<Props> = ({ current, draft, changed, onApply, onDiscard, t }) => (
  <Stack gap={8}>
    <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('settings.skills.ai.reviewHint')}</Text>
    {changed.map((rel) => (
      <Stack key={rel} gap={4}>
        <Text fz="var(--font-size-xs)" ff="var(--font-mono)" c="var(--text-muted)">{rel}</Text>
        <Box style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)', maxHeight: 360, overflowY: 'auto' }}>
          <TextDiffView before={current[rel] ?? ''} after={draft[rel] ?? ''} t={t} />
        </Box>
      </Stack>
    ))}
    <Group justify="flex-end" gap={8}>
      <AppButton variant="default" size="xs" onClick={onDiscard}>{t('settings.skills.ai.discard')}</AppButton>
      <AppButton size="xs" onClick={onApply}>{t('settings.skills.ai.apply')}</AppButton>
    </Group>
  </Stack>
);
