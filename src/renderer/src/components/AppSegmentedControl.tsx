import React from 'react';
import { SegmentedControl as MSegmentedControl } from '@mantine/core';
import type { MantineSize } from '@mantine/core';

interface AppSegmentedControlProps {
  value: string;
  /** A label may carry an icon or a status dot beside its words; its text stays the words alone. */
  options: { value: string; label: React.ReactNode }[];
  onChange: (value: string) => void;
  fullWidth?: boolean;
  size?: MantineSize;
  /**
   * The chosen segment in the accent's dim tint with normal text, the way the sidebar marks its
   * selected row, instead of filled: for a switch among list rows that must not outshout them.
   */
  quiet?: boolean;
  disabled?: boolean;
  /** The id of the visible label that names the group, for a control under a field label. */
  'aria-labelledby'?: string;
}

/** The chosen segment filled in brand, as Mantine draws `color="brand"` (no shadow, a filled button's label). */
const BRAND_SEGMENT_VARS = { '--sc-color': 'var(--mantine-primary-color-filled)', '--sc-shadow': 'none' } as const;

export const AppSegmentedControl: React.FC<AppSegmentedControlProps> = ({
  value,
  options,
  onChange,
  fullWidth = true,
  size,
  quiet = false,
  disabled,
  'aria-labelledby': labelledBy,
}) => (
  <MSegmentedControl
    value={value}
    onChange={onChange}
    data={options}
    fullWidth={fullWidth}
    size={size}
    disabled={disabled}
    role={labelledBy ? 'radiogroup' : undefined}
    aria-labelledby={labelledBy}
    // No `color`: Mantine would pick each segment's label (black or white) in JS from the brand
    // colour, and that pick follows the theme, which never re-renders this (theme/liveTheme.ts).
    // The brand fill and its label come in as variables instead, the same ones a filled button uses.
    vars={() => ({
      root: quiet ? { '--sc-color': 'var(--mantine-color-accent-dim)' } : BRAND_SEGMENT_VARS,
    })}
    styles={{
      root: {
        // Beside other items in a row, the words around it wrap first; the control gives way only
        // once it is wider than the whole row (max-width), never to make room for a neighbour.
        maxWidth: '100%',
        ...(fullWidth ? {} : { flexShrink: 0 }),
        background: 'var(--mantine-color-bg-tertiary)',
        border: '1px solid var(--mantine-color-default-border)',
        ...(quiet ? {} : { '--sc-label-color': 'var(--mantine-primary-color-contrast)' }),
      } as React.CSSProperties,
      indicator: {
        borderRadius: 'var(--mantine-radius-sm)',
        boxShadow: quiet ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.15)',
      },
      // Each segment starts from its own label's width (Mantine's `flex: 1` is a 0 basis, which
      // splits the width evenly and squeezed the longer label). It shrinks only when the container
      // is narrower than every label together, and then the label ends in an ellipsis: a segment
      // label is one line, never broken across two.
      control: { flex: fullWidth ? '1 1 auto' : '0 1 auto', minWidth: 0 },
      label: {
        fontSize: 'var(--font-size-sm)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        transition: 'color 150ms ease',
      },
    }}
  />
);
