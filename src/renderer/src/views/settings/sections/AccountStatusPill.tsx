import React from 'react';
import { Badge, Group, Loader, Text } from '@mantine/core';

export type PillState = 'in' | 'out' | 'checking';

export function pillStateOf(loggedIn: boolean | null): PillState {
  if (loggedIn === null) return 'checking';
  return loggedIn ? 'in' : 'out';
}

export const AccountStatusPill: React.FC<{ state: PillState; t: (key: string) => string }> = ({ state, t }) => {
  if (state === 'checking') {
    return (
      <Group gap={6} align="center" wrap="nowrap">
        <Loader size={12} />
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.accounts.status.checking')}</Text>
      </Group>
    );
  }
  const label = state === 'in'
    ? t('settings.accounts.status.loggedIn')
    : t('settings.accounts.status.loggedOut');
  return (
    <Badge variant="light" color={state === 'out' ? 'gray' : 'var(--mantine-color-success)'} size="sm">
      {label}
    </Badge>
  );
};
