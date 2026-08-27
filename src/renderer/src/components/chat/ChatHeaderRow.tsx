import React from 'react';
import { Group } from '@mantine/core';

interface ChatHeaderRowProps {
  children: React.ReactNode;
}

export const ChatHeaderRow: React.FC<ChatHeaderRowProps> = ({ children }) => (
  <Group
    gap={6}
    wrap="nowrap"
    p="6px 14px"
    bg="var(--mantine-color-default)"
    style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0, minWidth: 0 }}
  >
    {children}
  </Group>
);
