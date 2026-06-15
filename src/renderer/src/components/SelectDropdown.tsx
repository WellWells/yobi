import React from 'react';
import { Select } from '@mantine/core';
import type { SelectProps } from '@mantine/core';

type SelectOption = { value: string; label: string };
type SelectOptionGroup = { group: string; items: SelectOption[] };

export type SelectDropdownProps = Omit<SelectProps, 'data' | 'onChange'> & {
  options: (SelectOption | SelectOptionGroup)[];
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
