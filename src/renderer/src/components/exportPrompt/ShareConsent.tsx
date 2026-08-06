import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { AppButton } from '../AppButton';
import { ShareConsentPoints } from '../ShareConsentPoints';
import type { ExportPromptShareState, ExportPromptShareStrings } from '../../../../shared/types';

interface Props {
  share: ExportPromptShareState;
  strings: ExportPromptShareStrings;
  cancelLabel: string;
  onAccept: () => void;
  onCancel: () => void;
}

/* The same five points the chat dialog shows, in the same order — see SHARE_CONSENT_KEYS. */
export const ShareConsent: React.FC<Props> = ({ share, strings, cancelLabel, onAccept, onCancel }) => (
  <Stack gap={12}>
    <Text fz="var(--font-size-sm)" c="var(--mantine-color-text)" lh={1.7}>
      {strings.consentIntro}
    </Text>

    {/* Clamped so a verbose language pack scrolls instead of overflowing the fixed window. */}
    <Box style={{ maxHeight: 260, overflowY: 'auto' }}>
      <ShareConsentPoints points={share.consentPoints} />
    </Box>

    <Group gap={8} justify="flex-end" mt={2}>
      <AppButton variant="subtle" color="gray" onClick={onCancel}>{cancelLabel}</AppButton>
      <AppButton onClick={onAccept}>{strings.consentAccept}</AppButton>
    </Group>
  </Stack>
);
