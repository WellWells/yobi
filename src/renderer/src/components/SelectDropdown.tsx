import React from 'react';
import { Select } from '@mantine/core';
import type { SelectProps } from '@mantine/core';
import { Z_POPOVER } from '../config/zLayers';
import type { AccessibleNameProps } from './a11y';

type SelectOption = { value: string; label: string };
type SelectOptionGroup = { group: string; items: SelectOption[] };

export type SelectDropdownProps = Omit<SelectProps, 'data' | 'onChange' | 'label' | 'aria-label' | 'aria-labelledby'> & {
  options: (SelectOption | SelectOptionGroup)[];
  onChange: (value: string) => void;
} & AccessibleNameProps;

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
    comboboxProps={{ zIndex: Z_POPOVER }}
    scrollAreaProps={{ type: 'auto' }}
    styles={{
      input: {
        background: 'var(--mantine-color-bg-tertiary)',
        color: disabled ? 'var(--text-disabled)' : 'var(--mantine-color-text)',
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
