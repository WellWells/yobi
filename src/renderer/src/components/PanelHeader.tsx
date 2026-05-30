import React from 'react';
import { Box, Group, Text } from '@mantine/core';

export interface PanelHeaderProps {
  label: string;
  icon?: React.ReactNode;
  rightSection?: React.ReactNode;
  px?: string | number;
  py?: string | number;
  withBottomBorder?: boolean;
  labelSize?: string;
  iconColor?: string;
}

const headerTextStyle: React.CSSProperties = {
  display: 'block',
  letterSpacing: '-0.01em',
  lineHeight: 1.2,
};

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  label,
  icon,
  rightSection,
  px = 10,
  py = 8,
  withBottomBorder = true,
  labelSize = 'var(--font-size-base)',
  iconColor = 'var(--mantine-color-dimmed)',
}) => (
  <Group
    justify="space-between"
    gap={8}
    px={px}
    py={py}
    style={{
      borderBottom: withBottomBorder ? '1px solid var(--mantine-color-default-border)' : undefined,
      flexShrink: 0,
    }}
  >
    <Group gap={7} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
      {icon && (
        <Box c={iconColor} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, lineHeight: 0 }}>
          {icon}
        </Box>
      )}
      <Text
        fz={labelSize}
        fw={700}
        c="var(--mantine-color-text)"
        style={headerTextStyle}
      >
        {label}
      </Text>
    </Group>
    {rightSection && <Box style={{ flexShrink: 0 }}>{rightSection}</Box>}
  </Group>
);
