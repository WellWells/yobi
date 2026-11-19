import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import styles from '../styles/SettingRow.module.css';

export interface SettingRowProps {
  label: string;
  /** Plain text, or text with an inline link. */
  hint?: React.ReactNode;
  control: React.ReactNode;
  alignStart?: boolean;
}

// Rows carry no icon: the nav and the card title already say where the user is.
export const SettingRow: React.FC<SettingRowProps> = ({ label, hint, control, alignStart }) => (
  <Group className={styles.row} justify="space-between" align={alignStart ? 'flex-start' : 'center'} gap={12} wrap="wrap">
    <Stack className={styles.label} gap={0} style={{ minWidth: 0 }}>
      <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)" mb={hint ? 3 : 0}>{label}</Text>
      {hint && <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{hint}</Text>}
    </Stack>
    <Box className={styles.control} style={{ flexShrink: 0 }}>{control}</Box>
  </Group>
);
