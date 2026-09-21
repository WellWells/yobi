import React from 'react';
import { Anchor, Box, Flex, Group, Text } from '@mantine/core';

interface ComposerNoticeProps {
  /** The connector's own brand mark where there is one; a mode glyph otherwise. */
  icon?: React.ReactNode;
  message: string;
  actionLabel?: string | null;
  onAction?: (() => void) | null;
}

/**
 * A single status line inside the composer box, sharing the "what is riding on this send"
 * region with the attachment and quote chips. It lives above the textarea so it grows upward
 * and stays visibly attached to the input, rather than hanging off the bottom of the window.
 */
export const ComposerNotice: React.FC<ComposerNoticeProps> = ({
  icon,
  message,
  actionLabel,
  onAction,
}) => (
  <Flex
    align="center"
    justify="space-between"
    gap={8}
    p="7px 12px"
    style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
  >
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      {icon && (
        <Box c="var(--mantine-color-dimmed)" style={{ display: 'flex', flexShrink: 0 }}>
          {icon}
        </Box>
      )}
      {/* A flex child defaults to `min-width: auto`, which refuses to shrink below its text —
          without this the ellipsis never appears and a long notice shoves the undo off the row. */}
      <Text
        fz="var(--font-size-sm)"
        c="var(--mantine-color-dimmed)"
        truncate="end"
        style={{ minWidth: 0 }}
      >
        {message}
      </Text>
    </Group>
    {actionLabel && onAction && (
      <Anchor
        component="button"
        type="button"
        onClick={onAction}
        fz="var(--font-size-sm)"
        c="var(--mantine-color-accent)"
        style={{ flexShrink: 0 }}
      >
        {actionLabel}
      </Anchor>
    )}
  </Flex>
);
