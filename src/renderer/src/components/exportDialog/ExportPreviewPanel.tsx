import React, { useState } from 'react';
import { Box, Stack, Text } from '@mantine/core';
import type { MarkdownCaptureRequest } from '../../../../shared/types';
import { MAX_CAPTURE_HEIGHT } from '../../../../shared/types';
import { ScaledCardFrame } from '../capture/ScaledCardFrame';
import { SectionLabel } from './SectionLabel';

export interface ExportPreviewPanelProps {
  request: MarkdownCaptureRequest | null;
  t: (key: string) => string;
}

export const ExportPreviewPanel: React.FC<ExportPreviewPanelProps> = ({ request, t }) => {
  const [logicalHeight, setLogicalHeight] = useState(0);

  const turnCount = request?.options.cardLayout === 'bubble'
    ? (request.payload.turns?.length ?? 0)
    : 0;
  const tooTall = request?.options.format !== 'pdf' && logicalHeight > MAX_CAPTURE_HEIGHT;
  const pixelHeight = logicalHeight * (request?.options.pixelRatio ?? 1);

  return (
    <Stack gap={12} p={16} flex={1} bg="var(--bg-tertiary)" style={{ minHeight: 0, overflowY: 'auto' }}>
      <SectionLabel>{t('capture.preview')}</SectionLabel>
      {
}
      <Box flex={1} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'safe center' }}>
        <ScaledCardFrame request={request} onMeasure={setLogicalHeight} />
      </Box>
      {logicalHeight > 0 && (
        <Text fz="var(--font-size-sm)" c={tooTall ? 'var(--mantine-color-orange-5)' : 'var(--text-muted)'} ta="center">
          {[
            turnCount > 0 ? t('capture.turnCount').replace('{{count}}', String(turnCount)) : '',
            `${request?.options.width ?? 0} × ${Math.round(pixelHeight)} px`,
          ].filter(Boolean).join(' · ')}
          {tooTall && ` — ${t('capture.tooTall')}`}
        </Text>
      )}
    </Stack>
  );
};
