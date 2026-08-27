import React from 'react';
import { Box } from '@mantine/core';
import { captureBackgroundCss, paletteCardTheme } from '../../../../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../../../../shared/capturePalettes';

interface Props {
  palette: string;
  backgroundStyle: CaptureBackgroundStyle;
  direction: CaptureDirection;
  width: number;
  margin: number;
  boxWidth: number;
}

const LINE_WIDTHS = ['72%', '88%', '61%', '80%'];

export const CardSchematic: React.FC<Props> = ({
  palette, backgroundStyle, direction, width, margin, boxWidth,
}) => {
  const card = paletteCardTheme(palette);
  const dark = card === 'dark';
  const scale = boxWidth / width;
  const inset = Math.round(margin * scale);

  return (
    <Box
      aria-hidden
      style={{
        height: '100%',
        borderRadius: 'var(--mantine-radius-sm)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        background: captureBackgroundCss(palette, backgroundStyle, direction),
        padding: inset,
      }}
    >
      <Box
        style={{
          height: '100%',
          borderRadius: Math.max(3, Math.round(20 * scale)),
          background: dark ? 'rgba(13, 17, 23, 0.94)' : 'rgba(255, 255, 255, 0.96)',
          border: `1px solid ${dark ? 'rgba(201, 209, 217, 0.2)' : 'rgba(15, 23, 42, 0.1)'}`,
          boxShadow: dark ? '0 6px 18px rgba(0, 0, 0, 0.36)' : '0 6px 18px rgba(15, 23, 42, 0.12)',
          padding: '11px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          overflow: 'hidden',
        }}
      >
        {}
        <Box
          style={{
            width: '54%',
            height: 8,
            borderRadius: 4,
            background: dark ? 'rgba(240, 246, 252, 0.82)' : 'rgba(15, 23, 42, 0.72)',
          }}
        />
        {LINE_WIDTHS.map((lineWidth) => (
          <Box
            key={lineWidth}
            style={{
              width: lineWidth,
              height: 5,
              borderRadius: 3,
              background: dark ? 'rgba(201, 209, 217, 0.34)' : 'rgba(15, 23, 42, 0.26)',
            }}
          />
        ))}
      </Box>
    </Box>
  );
};
