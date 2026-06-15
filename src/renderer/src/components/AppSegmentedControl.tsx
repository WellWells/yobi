import React from 'react';
import { SegmentedControl as MSegmentedControl } from '@mantine/core';
import type { MantineSize } from '@mantine/core';

interface AppSegmentedControlProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  fullWidth?: boolean;
  size?: MantineSize;
}

export const AppSegmentedControl: React.FC<AppSegmentedControlProps> = ({
  value,
  options,
  onChange,
  fullWidth = true,
  size,
}) => (
  <MSegmentedControl
    value={value}
    onChange={onChange}
    data={options}
    fullWidth={fullWidth}
    size={size}
    color="brand"
    autoContrast
    styles={{
      root: {
        background: 'var(--mantine-color-bg-tertiary)',
        border: '1px solid var(--mantine-color-default-border)',
      },
      indicator: {
        borderRadius: 'var(--mantine-radius-sm)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
      },
      label: {
        fontSize: 'var(--font-size-sm)',
        transition: 'color 150ms ease',
      },
    }}
  />
);
