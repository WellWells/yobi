// src/renderer/src/components/SelectDropdown.tsx
// Themed Select wrapper — use instead of bare Mantine <Select> for consistent dark-theme styling.
import React from 'react';
import { Select } from '@mantine/core';
import type { SelectProps } from '@mantine/core';

export type SelectDropdownProps = Omit<SelectProps, 'data' | 'onChange'> & {
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};

export const SelectDropdown: React.FC<SelectDropdownProps> = ({
  value,
  options,
  onChange,
  disabled,
  styles,
  ...rest
}) => (
  <Select
    value={value}
    data={options}
    onChange={(v) => { if (v != null) onChange(v); }}
    disabled={disabled}
    allowDeselect={false}
    withCheckIcon
    comboboxProps={{ zIndex: 200 }}
    styles={{
      input: {
        background: 'var(--mantine-color-bg-tertiary)',
        borderColor: 'var(--mantine-color-default-border)',
        color: disabled ? 'var(--mantine-color-dimmed)' : 'var(--mantine-color-text)',
        fontSize: 'var(--font-size-base)',
        ...(typeof styles === 'object' && styles !== null && 'input' in styles ? (styles as Record<string, object>).input : {}),
      },
      dropdown: {
        background: 'var(--mantine-color-bg-tertiary)',
        borderColor: 'var(--mantine-color-default-border)',
        ...(typeof styles === 'object' && styles !== null && 'dropdown' in styles ? (styles as Record<string, object>).dropdown : {}),
      },
      option: {
        fontSize: 'var(--font-size-base)',
        ...(typeof styles === 'object' && styles !== null && 'option' in styles ? (styles as Record<string, object>).option : {}),
      },
    }}
    {...rest}
  />
);
