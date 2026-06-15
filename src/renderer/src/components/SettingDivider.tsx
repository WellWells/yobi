import React from 'react';
import { Box } from '@mantine/core';

export interface SettingDividerProps {
  danger?: boolean;
  my?: number;
}

export const SettingDivider: React.FC<SettingDividerProps> = ({ danger, my }) => (
  <Box
    h={1}
    my={my}
    bg={danger
      ? 'color-mix(in srgb, var(--mantine-color-error) 18%, transparent)'
      : 'var(--mantine-color-default-border)'}
  />
);
