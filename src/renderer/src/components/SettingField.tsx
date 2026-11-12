import React from 'react';
import { Group, Stack, Text } from '@mantine/core';

export interface SettingFieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  /** A small control at the right end of the label row (the custom instructions' "Tidy"). */
  action?: React.ReactNode;
}

// Like SettingRow, a field's label carries no icon.
export const SettingField: React.FC<SettingFieldProps> = ({ label, hint, children, action }) => (
  <Stack gap={6}>
    {action ? (
      <Group justify="space-between" align="center" wrap="nowrap" gap={8}>
        <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>
        {action}
      </Group>
    ) : (
      <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>
    )}
    {children}
    {hint && <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{hint}</Text>}
  </Stack>
);
