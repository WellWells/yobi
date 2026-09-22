import React, { useState } from 'react';
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2 } from 'lucide-react';

import { WebDialog } from '../../../components/WebDialog';
import type { LinePairedUser } from '../../../../../shared/types';

interface Props {
  pairedUsers: LinePairedUser[];
  onUnpair: (userId: string) => void;
  t: (key: string) => string;
}

export const LinePairedUsers: React.FC<Props> = ({ pairedUsers, onUnpair, t }) => {
  // Confirmed, like the other permanent removals: unpairing revokes someone's access to the
  // bot, and it used to happen on one click of a 26px icon.
  const [pending, setPending] = useState<LinePairedUser | null>(null);
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
              onClick={() => setPending(user)}
              aria-label={t('settings.line.paired.remove')}
            >
              <Trash2 size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}

      <WebDialog
        open={pending !== null}
        title={t('settings.line.paired.remove.title')}
        description={pending?.displayName || pending?.userId || ''}
        confirmText={t('settings.line.paired.remove')}
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
