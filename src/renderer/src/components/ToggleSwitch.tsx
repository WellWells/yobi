import React from 'react';
import { Switch } from '@mantine/core';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  label?: React.ReactNode;
  /** Secondary line under the label. Added so the export dialog could stop hand-rolling a
      bare <Switch>, which was the only switch in the app that turned accent-blue. */
  description?: React.ReactNode;
  'aria-label'?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  size = 'md',
  disabled,
  label,
  description,
  'aria-label': ariaLabel,
}) => (
  <Switch
    checked={checked}
    onChange={onChange}
    color="teal"
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
