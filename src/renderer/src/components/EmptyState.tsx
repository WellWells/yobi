import React from 'react';
import { Stack, Text } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  label: React.ReactNode;
  fill?: boolean;
  children?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, label, fill = false, children }) => (
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
    <Icon size={40} strokeWidth={1.5} />
    <Text fz="var(--font-size-base)">{label}</Text>
    {children}
  </Stack>
);
