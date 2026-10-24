import React from 'react';
import { Group, Text, UnstyledButton } from '@mantine/core';
import { Trash2 } from 'lucide-react';
import styles from '../Sidebar.module.css';

interface RecentlyDeletedRowProps {
  count: number;
  label: string;
  onOpen: () => void;
}

/**
 * The last row of the conversation list, there only while Recently Deleted holds something (as in
 * Apple Notes). Opens the list of deleted conversations.
 */
export const RecentlyDeletedRow: React.FC<RecentlyDeletedRowProps> = ({ count, label, onOpen }) => (
  <UnstyledButton
    className={styles.fileItem}
    w="100%"
    onClick={onOpen}
    aria-haspopup="dialog"
    data-selected="false"
  >
    <Group gap={8} wrap="nowrap">
      <Trash2 size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
      <Text fz="var(--font-size-sm)" flex={1} truncate>{label}</Text>
      <Text component="span" fz="var(--font-size-xs)" className={styles.timestamp}>{count}</Text>
    </Group>
  </UnstyledButton>
);
