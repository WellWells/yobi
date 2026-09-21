import React from 'react';
import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Shield, ShieldCheck, Unlink } from 'lucide-react';
import type { BotContact, TelegramPairedUser } from '../../../../../shared/types';

interface Props {
  pairedUsers: TelegramPairedUser[];
  contacts: BotContact[];
  adminUserIds: number[];
  onToggleAdmin: (userId: number) => void;
  onUnpair: (userId: number) => void;
  t: (key: string) => string;
}

function displayName(user: TelegramPairedUser): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  if (fullName) return user.username ? `${fullName} (@${user.username})` : fullName;
  return user.username ? `@${user.username}` : `ID ${user.userId}`;
}

export const TelegramPairedUsers: React.FC<Props> = ({
  pairedUsers, contacts, adminUserIds, onToggleAdmin, onUnpair, t,
}) => {
  if (pairedUsers.length === 0) {
    return (
      <Text fz="var(--font-size-sm)" c="dimmed" fs="italic">
        {t('settings.telegram.paired.empty')}
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      {pairedUsers.map((user) => {
        const isAdmin = adminUserIds.includes(user.userId);
        const reachability = contacts
          .find((entry) => entry.kind === 'user' && entry.id === String(user.userId))
          ?.reachability;
        const unreachable = reachability && reachability !== 'ok' ? reachability : null;
        const adminAction = isAdmin
          ? t('settings.telegram.admin.remove')
          : t('settings.telegram.admin.add');
        return (
          <Group
            key={user.userId}
            justify="space-between"
            align="center"
            gap={8}
            p="6px 8px"
            bg="var(--mantine-color-bg-tertiary)"
            style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
          >
            <Group gap={6} align="center" style={{ minWidth: 0 }}>
              <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>
                {displayName(user)}
              </Text>
              {isAdmin && (
                <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                  {t('settings.telegram.admin.badge')}
                </Badge>
              )}
              {unreachable && (
                <Badge size="xs" variant="light" color="orange" style={{ flexShrink: 0 }}>
                  {t(`settings.telegram.reach.${unreachable}`)}
                </Badge>
              )}
            </Group>
            <Group gap={4} wrap="nowrap">
              <Tooltip label={adminAction} position="top">
                <ActionIcon
                  variant="subtle"
                  size={26}
                  onClick={() => onToggleAdmin(user.userId)}
                  aria-label={adminAction}
                  c={isAdmin ? 'var(--mantine-color-accent)' : undefined}
                >
                  {isAdmin ? <ShieldCheck size={13} /> : <Shield size={13} />}
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('settings.telegram.pairing.unpair')} position="top">
                <ActionIcon
                  variant="subtle"
                  size={26}
                  onClick={() => onUnpair(user.userId)}
                  aria-label={t('settings.telegram.pairing.unpair')}
                >
                  <Unlink size={13} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
};
