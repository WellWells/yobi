import React, { useState } from 'react';
import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2 } from 'lucide-react';
import { WebDialog } from '../../../components/WebDialog';
import type { BotContact, TelegramChannel } from '../../../../../shared/types';

interface Props {
  channels: TelegramChannel[];
  contacts: BotContact[];
  onForget: (chatId: number) => void;
  t: (key: string) => string;
}

export const TelegramChannels: React.FC<Props> = ({ channels, contacts, onForget, t }) => {
  // Confirmed like the other permanent removals: forgetting a channel drops it from the
  // directory, and every flow that sends there stops knowing its name.
  const [pending, setPending] = useState<TelegramChannel | null>(null);
  if (channels.length === 0) {
    return (
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
        {t('settings.telegram.channels.howto')}
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
        {t('settings.telegram.channels.hintShort')}
      </Text>
      {channels.map((channel) => {
        const reachability = contacts
          .find((entry) => entry.kind === 'chat' && entry.id === String(channel.chatId))
          ?.reachability;
        const unreachable = reachability && reachability !== 'ok' ? reachability : null;
        return (
        <Group
          key={channel.chatId}
          justify="space-between"
          align="center"
          gap={8}
          p="6px 8px"
          bg="var(--mantine-color-bg-tertiary)"
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
        >
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap={6} align="center" wrap="nowrap">
              <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>
                {channel.title || `ID ${channel.chatId}`}
              </Text>
              {channel.chatType && (
                <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                  {t(`settings.telegram.channels.kind.${channel.chatType === 'channel' ? 'channel' : 'group'}`)}
                </Badge>
              )}
              {unreachable && (
                <Badge size="xs" variant="light" color="orange" style={{ flexShrink: 0 }}>
                  {t(`settings.telegram.reach.${unreachable}`)}
                </Badge>
              )}
            </Group>
            <Text fz="var(--font-size-sm)" c={channel.canPost ? 'dimmed' : 'var(--mantine-color-warning)'}>
              {channel.username ? `@${channel.username}` : channel.chatId}
              {' · '}
              {channel.canPost
                ? t('settings.telegram.channels.active')
                : t('settings.telegram.channels.lost')}
            </Text>
          </Stack>
          <Tooltip label={t('settings.telegram.channels.forget')} position="top">
            <ActionIcon
              variant="subtle"
              size={26}
              onClick={() => setPending(channel)}
              aria-label={t('settings.telegram.channels.forget')}
            >
              <Trash2 size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
        );
      })}

      <WebDialog
        open={pending !== null}
        title={t('settings.telegram.channels.forget.title')}
        description={pending?.title || String(pending?.chatId ?? '')}
        confirmText={t('settings.telegram.channels.forget')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (target) onForget(target.chatId);
        }}
        onCancel={() => setPending(null)}
      />
    </Stack>
  );
};
