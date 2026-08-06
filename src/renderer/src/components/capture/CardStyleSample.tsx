import React, { useMemo } from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { ScaledCardFrame } from './ScaledCardFrame';
import { captureBackgroundCss, paletteCardTheme } from '../../../../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../../../../shared/capturePalettes';
import type { CardLayout, MarkdownCaptureRequest } from '../../../../shared/types';

const SAMPLE_PROMPT = 'How do I keep the exported card readable?';
const SAMPLE_RESPONSE = [
  '### Three things matter',
  '',
  '- **Width** sets the line length',
  '- Hi-DPI doubles the pixels, not the layout',
  '- Everything else is chosen per export',
].join('\n');

export interface CardStyleSampleProps {
  palette: string;
  backgroundStyle: CaptureBackgroundStyle;
  direction: string;
  cardLayout: CardLayout;
  width: number;
  hiDpi: boolean;
  t: (key: string) => string;
}

export const CardStyleSample: React.FC<CardStyleSampleProps> = ({
  palette, backgroundStyle, direction, cardLayout, width, hiDpi, t,
}) => {
  const request = useMemo<MarkdownCaptureRequest>(() => ({
    payload: {
      title: t('settings.cardStyle.sample.title'),
      prompt: SAMPLE_PROMPT,
      content: SAMPLE_RESPONSE,
      summary: '',
      provider: '',
      timestamp: '',
      turns: [{ prompt: SAMPLE_PROMPT, response: SAMPLE_RESPONSE }],
    },
    options: {
      mode: 'copy',
      format: 'png',
      showPrompt: true,
      showContent: true,
      showProvider: false,
      showTimestamp: false,
      showTokens: false,
      width,
      background: captureBackgroundCss(palette, backgroundStyle, (direction || 'se') as CaptureDirection),
      cardTheme: paletteCardTheme(palette),
      cardLayout,
      pixelRatio: hiDpi ? 2 : 1,
      zip: false,
    },
  }), [palette, backgroundStyle, direction, cardLayout, width, hiDpi, t]);

  return (
    <Stack gap={8}>
      {
}
      <Box style={{ maxWidth: 420 }}>
        <ScaledCardFrame request={request} />
      </Box>
      <Text fz="var(--font-size-sm)" c="var(--text-muted)">
        {hiDpi ? `${width} px · 2× → ${width * 2} px` : `${width} px`}
      </Text>
    </Stack>
  );
};
