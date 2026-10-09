import React from 'react';
import { Text } from '@mantine/core';

/** A field label above one export control: the same type as an input's label (inputStyles.ts). */
export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)" mb={8}>
    {children}
  </Text>
);
