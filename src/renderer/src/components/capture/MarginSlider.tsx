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

interface CaptureSliderProps extends Props {
  min: number;
  max: number;
  step: number;
  marks: readonly number[];
  /** How a value reads on the thumb and to a screen reader. */
  format: (value: number) => string;
  /** How a mark under the track reads; defaults to `format`. */
  markFormat?: (value: number) => string;
}

/**
 * The look of every card slider (margin, opacity) in the quick-export panel, the export dialog and
 * Settings. Mantine draws the marks outside the element's box, so the slider reserves its own room.
 */
export const CaptureSlider: React.FC<CaptureSliderProps> = ({
  value, onChange, label, w, min, max, step, marks, format, markFormat = format,
}) => (
  <Slider
    w={w}
    mb={16}
    value={value}
    onChange={onChange}
    min={min}
    max={max}
    step={step}
    marks={marks.map((mark) => ({ value: mark, label: markFormat(mark) }))}
    label={format}
    labelAlwaysOn={false}
    size="sm"
    color="brand"
    thumbLabel={label}
    thumbValueText={format}
    styles={{
      markLabel: { fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' },
      mark: { borderColor: 'var(--border)' },
      track: { '--slider-track-bg': 'var(--bg-tertiary)' } as React.CSSProperties,
    }}
  />
);

export const MarginSlider: React.FC<Props> = ({ value, ...props }) => (
  <CaptureSlider
    {...props}
    value={clampCaptureMargin(value)}
    min={0}
    max={MAX_CAPTURE_MARGIN}
    step={CAPTURE_MARGIN_STEP}
    marks={CAPTURE_MARGIN_MARKS}
    format={(current) => `${current} px`}
    markFormat={String}
  />
);
