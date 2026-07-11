import React from 'react';
import { Box, Group, Modal, type ModalProps, Text } from '@mantine/core';

type ModalStyles = ModalProps['styles'];

// Single source of truth for dialog chrome — a framed card on the elevated
// surface with a header divider, mirroring the export dialog the app is tuned to.
const CHROME_STYLES: Record<string, React.CSSProperties> = {
  content: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
  },
  header: {
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
  },
  // Mantine zeroes body padding-top when a header exists (it assumes no divider);
  // our header divider needs breathing room below it, symmetric with the header padding.
  body: {
    paddingTop: 'var(--mantine-spacing-md)',
  },
};

// Merge the shared chrome with a caller's per-selector overrides so a dialog can
// tweak (e.g.) content max-height or a danger border without losing the frame.
function mergeChrome(overrides?: ModalStyles): ModalStyles {
  const extra = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, React.CSSProperties>;
  const merged: Record<string, React.CSSProperties> = {};
  for (const key of new Set([...Object.keys(CHROME_STYLES), ...Object.keys(extra)])) {
    merged[key] = { ...CHROME_STYLES[key], ...extra[key] };
  }
  return merged as ModalStyles;
}

export interface AppModalProps extends Omit<ModalProps, 'title'> {
  /** Optional lucide icon rendered in the accent color left of the title. */
  icon?: React.ReactNode;
  title: React.ReactNode;
}

/**
 * Standardized app dialog: framed chrome + accent icon + bold title.
 * Use for every content dialog so they read as one family. Behaves as a
 * drop-in `Modal` — all other Modal props pass through.
 */
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
