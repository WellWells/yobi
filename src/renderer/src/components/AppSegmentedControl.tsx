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
    color={quiet ? undefined : 'brand'}
    autoContrast={!quiet}
    styles={{
      root: {
        background: 'var(--mantine-color-bg-tertiary)',
        border: '1px solid var(--mantine-color-default-border)',
        ...(quiet ? { '--sc-color': 'var(--mantine-color-accent-dim)' } : {}),
      } as React.CSSProperties,
      indicator: {
        borderRadius: 'var(--mantine-radius-sm)',
        boxShadow: quiet ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.15)',
      },
      label: {
        fontSize: 'var(--font-size-sm)',
        transition: 'color 150ms ease',
      },
    }}
  />
);
