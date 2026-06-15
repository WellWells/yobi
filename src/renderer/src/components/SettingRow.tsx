import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';

export interface SettingRowProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  control: React.ReactNode;
  alignStart?: boolean;
}

export const SettingRow: React.FC<SettingRowProps> = ({ icon, label, hint, control, alignStart }) => (
  <Group justify="space-between" align={alignStart ? 'flex-start' : 'center'} gap={12} wrap="nowrap">
    <Stack gap={0} flex={1} style={{ minWidth: 0 }}>
      <Group gap={6} wrap="nowrap" mb={hint ? 3 : 0}>
        <Box c="dimmed" style={{ flexShrink: 0 }}>{icon}</Box>
        <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>
      </Group>
      {hint && <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{hint}</Text>}
    </Stack>
    <Box style={{ flexShrink: 0 }}>{control}</Box>
  </Group>
);
