import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';

export interface SettingFieldProps {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}

export const SettingField: React.FC<SettingFieldProps> = ({ icon, label, hint, children }) => (
  <Stack gap={6}>
    <Group gap={6} wrap="nowrap">
      {icon && <Box c="dimmed" style={{ flexShrink: 0 }}>{icon}</Box>}
      <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>
    </Group>
    {children}
    {hint && <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{hint}</Text>}
  </Stack>
);
