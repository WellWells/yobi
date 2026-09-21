import React from 'react';
import { MultiSelect } from '@mantine/core';
import type { MultiSelectProps } from '@mantine/core';
import { Z_POPOVER } from '../config/zLayers';

type SelectOption = { value: string; label: string };
type SelectOptionGroup = { group: string; items: SelectOption[] };

export type MultiSelectDropdownProps = Omit<MultiSelectProps, 'data' | 'onChange'> & {
  options: (SelectOption | SelectOptionGroup)[];
  onChange: (value: string[]) => void;
};

/**
 * The multi-value twin of SelectDropdown, styled from the same tokens so a single-choice and a
 * multi-choice field on the same form are indistinguishable apart from the pills. Picked values
 * stay in the order they were picked, which is what the callers persist.
 */
export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  value,
  options,
  onChange,
  disabled,
  styles,
  ...rest
}) => (
  <MultiSelect
    value={value}
    data={options}
    onChange={onChange}
    disabled={disabled}
    withCheckIcon
    hidePickedOptions
    comboboxProps={{ zIndex: Z_POPOVER }}
    scrollAreaProps={{ type: 'auto' }}
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
      pill: {
        background: 'var(--mantine-color-accent-dim)',
        color: 'var(--mantine-color-accent)',
        ...(typeof styles === 'object' && styles !== null && 'pill' in styles ? (styles as Record<string, object>).pill : {}),
      },
    }}
    {...rest}
  />
);
