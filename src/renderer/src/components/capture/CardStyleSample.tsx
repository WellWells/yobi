import React, { useMemo } from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { ScaledCardFrame } from './ScaledCardFrame';
import { captureBackgroundCss, paletteCardTheme } from '../../../../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../../../../shared/capturePalettes';
import type { CardLayout, MarkdownCaptureRequest } from '../../../../shared/types';

export interface CardStyleSampleProps {
  palette: string;
  backgroundStyle: CaptureBackgroundStyle;
  direction: string;
  cardLayout: CardLayout;
  width: number;
  margin: number;
  hiDpi: boolean;
  t: (key: string) => string;
}

/** The preview card's request; every word on it comes from the locale pack. */
export function sampleCardRequest(props: Omit<CardStyleSampleProps, 't'>, t: (key: string) => string): MarkdownCaptureRequest {
  const { palette, backgroundStyle, direction, cardLayout, width, margin, hiDpi } = props;
  const prompt = t('settings.cardStyle.sample.prompt');
  const response = [
    `### ${t('settings.cardStyle.sample.heading')}`,
    '',
    `- ${t('settings.cardStyle.sample.width')}`,
    `- ${t('settings.cardStyle.sample.hiDpi')}`,
    `- ${t('settings.cardStyle.sample.rest')}`,
  ].join('\n');
  return {
    payload: {
      title: t('settings.cardStyle.sample.title'),
      prompt,
      content: response,
      summary: '',
      provider: '',
      timestamp: '',
      turns: [{ prompt, response }],
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
      margin,
      background: captureBackgroundCss(palette, backgroundStyle, (direction || 'se') as CaptureDirection),
      cardTheme: paletteCardTheme(palette),
      cardLayout,
      pixelRatio: hiDpi ? 2 : 1,
      zip: false,
    },
  };
}

export const CardStyleSample: React.FC<CardStyleSampleProps> = ({
  palette, backgroundStyle, direction, cardLayout, width, margin, hiDpi, t,
}) => {
  const request = useMemo<MarkdownCaptureRequest>(
    () => sampleCardRequest({ palette, backgroundStyle, direction, cardLayout, width, margin, hiDpi }, t),
    [palette, backgroundStyle, direction, cardLayout, width, margin, hiDpi, t],
  );

  return (
    <Stack gap={8}>
      <Box style={{ maxWidth: 420 }}>
        <ScaledCardFrame request={request} />
      </Box>
      <Text fz="var(--font-size-sm)" c="var(--text-muted)">
        {hiDpi ? `${width} px · 2× → ${width * 2} px` : `${width} px`}
      </Text>
    </Stack>
  );
};
