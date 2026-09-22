import React from 'react';
import { Group } from '@mantine/core';

interface ChatHeaderRowProps {
  children: React.ReactNode;
}

/**
 * 47px is what `PanelToolbar` measures next door (py 8 + a 30px control + the 1px border), so
 * the rule under the title bar runs straight across the window instead of stepping 6px at the
 * sidebar divider. A min-height rather than vertical padding also keeps the band from twitching
 * when the 30px rename input swaps in.
 */
export const ChatHeaderRow: React.FC<ChatHeaderRowProps> = ({ children }) => (
  <Group
    gap={6}
    wrap="nowrap"
    mih={47}
    px="14px"
    bg="var(--mantine-color-default)"
    style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0, minWidth: 0 }}
  >
    {children}
  </Group>
);
