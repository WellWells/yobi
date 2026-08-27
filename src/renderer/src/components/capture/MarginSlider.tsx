import React from 'react';
import { Slider } from '@mantine/core';
import {
  CAPTURE_MARGIN_MARKS, CAPTURE_MARGIN_STEP, MAX_CAPTURE_MARGIN, clampCaptureMargin,
} from '../../../../shared/types';

interface Props {
  value: number;
  onChange: (value: number) => void;
  label: string;
  w?: number | string;
}

export const MarginSlider: React.FC<Props> = ({ value, onChange, label, w }) => (
  <Slider
    w={w}
    mb={16}
    value={clampCaptureMargin(value)}
    onChange={onChange}
    min={0}
    max={MAX_CAPTURE_MARGIN}
    step={CAPTURE_MARGIN_STEP}
    marks={CAPTURE_MARGIN_MARKS.map((mark) => ({ value: mark, label: String(mark) }))}
    label={(current) => `${current} px`}
    labelAlwaysOn={false}
    size="sm"
    color="brand"
    aria-label={label}
    styles={{
      markLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' },
      mark: { borderColor: 'var(--border)' },
      track: { '--slider-track-bg': 'var(--bg-tertiary)' } as React.CSSProperties,
    }}
  />
);
