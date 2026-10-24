import React from 'react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';
import styles from './SidebarActionRow.module.css';

export interface SidebarActionRowProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Controls at the row's right end, beside (not inside) the row's own button. */
  trailing?: React.ReactNode;
}

/**
 * A sidebar's main action ("New chat", "New flow"), leading its toolbar and filling the width the
 * icon buttons leave: drawn as a list row, with no border and a fill only on hover. Forwards its
 * ref to the row's button so it can be a Tooltip target.
 */
export const SidebarActionRow = React.forwardRef<HTMLButtonElement, SidebarActionRowProps>(({
  icon: Icon, label, onClick, trailing,
}, ref) => (
  <Box className={styles.row}>
    <UnstyledButton ref={ref} className={styles.button} onClick={onClick}>
      <Icon size={15} />
      <Text component="span" fz="var(--font-size-base)" fw={500} truncate>{label}</Text>
    </UnstyledButton>
    {trailing}
  </Box>
));

SidebarActionRow.displayName = 'SidebarActionRow';
