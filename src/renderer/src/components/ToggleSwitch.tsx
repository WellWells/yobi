// src/renderer/src/components/ToggleSwitch.tsx
// Standardized Switch with enforced visual style. Use instead of bare Mantine <Switch>.
import React from 'react';
import { Switch } from '@mantine/core';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  disabled?: boolean;
  label?: React.ReactNode;
  title?: string;
  'aria-label'?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  size = 'md',
  disabled,
  label,
  title,
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
    title={title}
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
