import React from 'react';
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2 } from 'lucide-react';
import type { TelegramChannel } from '../../../../../shared/types';

interface Props {
  channels: TelegramChannel[];
  onForget: (chatId: number) => void;
  t: (key: string) => string;
}

export const TelegramChannels: React.FC<Props> = ({ channels, onForget, t }) => {
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
      {channels.map((channel) => (
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
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>
              {channel.title || `ID ${channel.chatId}`}
            </Text>
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
              onClick={() => onForget(channel.chatId)}
              aria-label={t('settings.telegram.channels.forget')}
            >
              <Trash2 size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}
    </Stack>
  );
};
