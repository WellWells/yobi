import React from 'react';
import { Loader, Stack, Text } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';

export interface EmptyStateProps {
  icon: LucideIcon;
  label: React.ReactNode;
  fill?: boolean;
  children?: React.ReactNode;
  /**
   * Still fetching. The biggest panes drew "there is nothing here" during the wait, which is a
   * different and much more alarming statement than "one moment" — on a cold file cache the
   * conversation list says the user's saved chats are gone for as long as the read takes.
   */
  busy?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, label, fill = false, children, busy = false }) => {
  const t = useI18nStore((state) => state.t);
  return (
    <Stack
      align="center"
      justify="center"
      gap={12}
      px={20}
      py={fill ? 20 : 40}
      flex={fill ? 1 : undefined}
      h={fill ? '100%' : undefined}
      c="dimmed"
      ta="center"
      ff="var(--font-sans)"
    >
      {busy ? <Loader size={28} color="var(--mantine-color-accent)" /> : <Icon size={40} strokeWidth={1.5} />}
      <Text fz="var(--font-size-base)">{busy ? t('common.loading') : label}</Text>
      {!busy && children}
    </Stack>
  );
};
