import React from 'react';
import { Box, Group, Modal, type ModalProps, Text } from '@mantine/core';

type ModalStyles = ModalProps['styles'];

const CHROME_STYLES: Record<string, React.CSSProperties> = {
  content: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
  },
  header: {
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
  },
  body: {
    paddingTop: 'var(--mantine-spacing-md)',
  },
};

function mergeChrome(overrides?: ModalStyles): ModalStyles {
  const extra = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, React.CSSProperties>;
  const merged: Record<string, React.CSSProperties> = {};
  for (const key of new Set([...Object.keys(CHROME_STYLES), ...Object.keys(extra)])) {
    merged[key] = { ...CHROME_STYLES[key], ...extra[key] };
  }
  return merged as ModalStyles;
}

export interface AppModalProps extends Omit<ModalProps, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
}

export const AppModal: React.FC<AppModalProps> = ({
  icon,
  title,
  styles,
  centered = true,
  children,
  ...rest
}) => (
  <Modal
    centered={centered}
    styles={mergeChrome(styles)}
    title={
      <Group gap={8} wrap="nowrap">
        {icon != null && (
          <Box c="var(--accent)" style={{ display: 'flex', flexShrink: 0 }}>
            {icon}
          </Box>
        )}
        <Text component="span" fz="var(--font-size-xl)" fw={700} c="var(--text-primary)">
          {title}
        </Text>
      </Group>
    }
    {...rest}
  >
    {children}
  </Modal>
);
