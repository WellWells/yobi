import React from 'react';
import { Loader, Stack, Text } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';

export interface EmptyStateProps {
  icon: LucideIcon;
  label: React.ReactNode;
  fill?: boolean;
  children?: React.ReactNode;
  /** Still fetching: shows a loader, so a slow read never claims the user's saved data is gone. */
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
