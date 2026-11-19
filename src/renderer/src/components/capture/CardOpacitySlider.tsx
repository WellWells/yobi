import React from 'react';
import {
  CARD_OPACITY_MARKS, CARD_OPACITY_STEP, MAX_CARD_OPACITY, MIN_CARD_OPACITY, clampCardOpacity,
} from '../../../../shared/types';
import { CaptureSlider } from './MarginSlider';

interface Props {
  value: number;
  onChange: (value: number) => void;
  label: string;
  w?: number | string;
}

/** How opaque the card under the text is; shared by the quick-export panel, the export dialog and Settings. */
export const CardOpacitySlider: React.FC<Props> = ({ value, ...props }) => (
  <CaptureSlider
    {...props}
    value={clampCardOpacity(value)}
    min={MIN_CARD_OPACITY}
    max={MAX_CARD_OPACITY}
    step={CARD_OPACITY_STEP}
    marks={CARD_OPACITY_MARKS}
    format={(current) => `${current}%`}
    // Bare numbers under the track, like the margin slider: "40%" and "100%" ran past both ends.
    markFormat={String}
  />
);
