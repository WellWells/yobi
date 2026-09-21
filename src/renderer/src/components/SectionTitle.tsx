import React from 'react';
import { Box, Group } from '@mantine/core';

export interface SectionTitleProps {
  icon: React.ReactNode;
  label: string;
  mb?: number;
  c?: string;
  /** Actions pinned to the right of the heading, so a long list never buries them. */
  rightSection?: React.ReactNode;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({ icon, label, mb = 10, c, rightSection }) => (
  <Group
    gap={8}
    mb={mb}
    fz="var(--font-size-md)"
    fw={700}
    c={c ?? 'var(--mantine-color-text)'}
    align="center"
    wrap="nowrap"
  >
    {icon}
    {label}
    {rightSection && (
      <Box ml="auto" fw={400} style={{ flexShrink: 0 }}>
        {rightSection}
      </Box>
    )}
  </Group>
);
