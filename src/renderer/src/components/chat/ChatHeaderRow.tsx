import React from 'react';
import { Group } from '@mantine/core';

interface ChatHeaderRowProps {
  children: React.ReactNode;
}

/** 47px matches `PanelToolbar` so the header rule lines up; min-height keeps it steady when the rename input swaps in. */
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
