import React from 'react';
import { Paper } from '@mantine/core';

export interface SectionCardProps {
  children: React.ReactNode;
  danger?: boolean;
  style?: React.CSSProperties;
  /** For a jump to the card (the flow outline's entries). */
  id?: string;
}

// The danger card is the normal card surface with a faint cast of the theme's error colour,
// the same colour its title and divider use.
const DANGER_BG = 'color-mix(in srgb, var(--mantine-color-error) 6%, var(--mantine-color-default))';
const DANGER_BORDER = 'color-mix(in srgb, var(--mantine-color-error) 45%, transparent)';

export const SectionCard: React.FC<SectionCardProps> = ({ children, danger, style, id }) => (
  <Paper
    id={id}
    withBorder
    shadow="xs"
    radius="md"
    p="md"
    bg={danger ? DANGER_BG : 'var(--mantine-color-default)'}
    style={{ ...(danger ? { borderColor: DANGER_BORDER } : {}), ...style }}
  >
    {children}
  </Paper>
);
