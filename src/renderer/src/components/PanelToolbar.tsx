import React from 'react';
import { Group } from '@mantine/core';

export interface PanelToolbarProps {
  children: React.ReactNode;
  px?: string | number;
  py?: string | number;
  gap?: number;
  withBottomBorder?: boolean;
  justify?: React.ComponentProps<typeof Group>['justify'];
}

export const PanelToolbar: React.FC<PanelToolbarProps> = ({
  children,
  px = 10,
  py = 8,
  gap = 8,
  withBottomBorder = false,
  justify = 'space-between',
}) => (
  <Group
    wrap="nowrap"
    gap={gap}
    px={px}
    py={py}
    justify={justify}
    style={{
      borderBottom: withBottomBorder ? '1px solid var(--mantine-color-default-border)' : undefined,
      flexShrink: 0,
    }}
  >
    {children}
  </Group>
);
