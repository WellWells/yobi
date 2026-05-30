// src/renderer/src/components/SectionTitle.tsx
// Consistent section heading with icon + label, used across all sections.
import React from 'react';
import { Group } from '@mantine/core';

export interface SectionTitleProps {
  icon: React.ReactNode;
  label: string;
  mb?: number;
  c?: string;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({ icon, label, mb = 10, c }) => (
  <Group
    gap={8}
    mb={mb}
    fz="var(--font-size-md)"
    fw={700}
    c={c ?? 'var(--mantine-color-text)'}
    align="center"
  >
    {icon}
    {label}
  </Group>
);
