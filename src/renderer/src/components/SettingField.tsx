import React from 'react';
import { Stack, Text } from '@mantine/core';

export interface SettingFieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

// Like SettingRow, a field's label carries no icon.
export const SettingField: React.FC<SettingFieldProps> = ({ label, hint, children }) => (
  <Stack gap={6}>
    <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>
    {children}
    {hint && <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{hint}</Text>}
  </Stack>
);
