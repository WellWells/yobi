import React from 'react';
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2 } from 'lucide-react';

import type { LinePairedUser } from '../../../../../shared/types';

interface Props {
  pairedUsers: LinePairedUser[];
  onUnpair: (userId: string) => void;
  t: (key: string) => string;
}

export const LinePairedUsers: React.FC<Props> = ({ pairedUsers, onUnpair, t }) => {
  if (pairedUsers.length === 0) {
    return <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.line.paired.empty')}</Text>;
  }

  return (
    <Stack gap={6}>
      {pairedUsers.map((user) => (
        <Group
          key={user.userId}
          justify="space-between"
          align="center"
          gap={8}
          p="6px 8px"
          bg="var(--mantine-color-bg-tertiary)"
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
        >
          <Stack gap={2} style={{ overflow: 'hidden' }}>
            <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">
              {user.displayName || t('settings.line.paired.unknownName')}
            </Text>
            <Text
              fz="var(--font-size-sm)"
              c="dimmed"
              ff="var(--font-mono)"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {user.userId}
            </Text>
          </Stack>
          <Tooltip label={t('settings.line.paired.remove')} position="top">
            <ActionIcon
              variant="subtle"
              size={26}
              onClick={() => onUnpair(user.userId)}
              aria-label={t('settings.line.paired.remove')}
            >
              <Trash2 size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}
    </Stack>
  );
};
