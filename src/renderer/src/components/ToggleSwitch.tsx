import React from 'react';
import { Switch } from '@mantine/core';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  label?: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  'aria-label'?: string;
  /** -1 when the switch only shows a row's state (a menu row that toggles on click). */
  tabIndex?: number;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  size = 'md',
  disabled,
  label,
  description,
  'aria-label': ariaLabel,
  tabIndex,
}) => (
  <Switch
    checked={checked}
    onChange={onChange}
    tabIndex={tabIndex}
    color="var(--mantine-color-success)"
    size={size}
    withThumbIndicator={false}
    disabled={disabled}
    label={label}
    description={description}
    aria-label={ariaLabel}
    styles={{
      track: {
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderColor: checked ? 'var(--mantine-color-success)' : 'var(--mantine-color-default-border)',
        backgroundColor: checked ? 'var(--mantine-color-success)' : 'var(--mantine-color-default-border)',
      },
    }}
  />
);
