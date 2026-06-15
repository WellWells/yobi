import React from 'react';
import { Paper } from '@mantine/core';

export interface SectionCardProps {
  children: React.ReactNode;
  danger?: boolean;
  style?: React.CSSProperties;
}

export const SectionCard: React.FC<SectionCardProps> = ({ children, danger, style }) => (
  <Paper
    withBorder
    shadow="xs"
    radius="md"
    p="md"
    bg={danger
      ? 'linear-gradient(180deg, rgba(248,81,73,0.08), rgba(248,81,73,0.03))'
      : 'var(--mantine-color-default)'}
    style={{ ...(danger ? { borderColor: 'rgba(248,81,73,0.45)' } : {}), ...style }}
  >
    {children}
  </Paper>
);
