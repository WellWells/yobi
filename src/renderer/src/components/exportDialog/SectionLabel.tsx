import React from 'react';
import { Text } from '@mantine/core';

export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fz="var(--font-size-base)" fw={700} lts="0.05em" tt="uppercase" c="var(--text-muted)" mb={8}>
    {children}
  </Text>
);
