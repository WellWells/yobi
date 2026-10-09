import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Unlink } from 'lucide-react';
import { WebDialog } from '../../../components/WebDialog';
import { telegramAccountHandle, telegramAccountLabel } from '../../../utils/botAccountLabel';
import { BotUserPermissions } from './BotUserPermissions';
import type { BotAccessControls } from '../hooks/useBotAccessControls';
import type { BotContact, TelegramPairedUser } from '../../../../../shared/types';

interface Props {
  pairedUsers: TelegramPairedUser[];
  contacts: BotContact[];
  access: BotAccessControls;
  onUnpair: (userId: number) => void;
  t: (key: string) => string;
}

export const TelegramPairedUsers: React.FC<Props> = ({
  pairedUsers, contacts, access, onUnpair, t,
}) => {
  // Confirmed like LINE's: unpairing also drops every grant the account had.
  const [pending, setPending] = useState<TelegramPairedUser | null>(null);
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
        const reachability = contacts
          .find((entry) => entry.kind === 'user' && entry.id === String(user.userId))
          ?.reachability;
        const unreachable = reachability && reachability !== 'ok' ? reachability : null;
        const handle = telegramAccountHandle(user);
        return (
          <Box
            key={user.userId}
            p="6px 8px"
            bg="var(--mantine-color-bg-tertiary)"
            style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
          >
            <Group justify="space-between" align="center" gap={8} wrap="nowrap">
              <Group gap={6} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
                <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" truncate>
                  {telegramAccountLabel(user, t)}
                </Text>
                {handle && (
                  <Text fz="var(--font-size-sm)" c="dimmed" truncate>{handle}</Text>
                )}
                {unreachable && (
                  <Badge size="xs" variant="light" color="var(--mantine-color-warning)" style={{ flexShrink: 0 }}>
                    {t(`settings.telegram.reach.${unreachable}`)}
                  </Badge>
                )}
              </Group>
              <Tooltip label={t('settings.telegram.pairing.unpair')} position="top">
                <ActionIcon
                  variant="subtle"
                  size={26}
                  onClick={() => setPending(user)}
                  aria-label={t('settings.telegram.pairing.unpair')}
                >
                  <Unlink size={13} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Box mt={6}>
              <BotUserPermissions access={access} userId={String(user.userId)} t={t} />
            </Box>
          </Box>
        );
      })}

      <WebDialog
        open={pending !== null}
        title={t('settings.telegram.pairing.unpair.title')}
        description={pending ? telegramAccountLabel(pending, t) : ''}
        confirmText={t('settings.telegram.pairing.unpair')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (target) onUnpair(target.userId);
        }}
        onCancel={() => setPending(null)}
      />
    </Stack>
  );
};
