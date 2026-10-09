import React, { useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Trash2 } from 'lucide-react';

import { WebDialog } from '../../../components/WebDialog';
import { BotUserPermissions } from './BotUserPermissions';
import type { BotAccessControls } from '../hooks/useBotAccessControls';
import type { LinePairedUser } from '../../../../../shared/types';

interface Props {
  pairedUsers: LinePairedUser[];
  access: BotAccessControls;
  onUnpair: (userId: string) => void;
  t: (key: string) => string;
}

export const LinePairedUsers: React.FC<Props> = ({ pairedUsers, access, onUnpair, t }) => {
  // Confirmed like other permanent removals: unpairing revokes the account's bot access.
  const [pending, setPending] = useState<LinePairedUser | null>(null);
  if (pairedUsers.length === 0) {
    return <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.line.paired.empty')}</Text>;
  }

  return (
    <Stack gap={6}>
      {pairedUsers.map((user) => (
        <Box
          key={user.userId}
          p="6px 8px"
          bg="var(--mantine-color-bg-tertiary)"
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
        >
          <Group justify="space-between" align="center" gap={8} wrap="nowrap">
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
          <Box mt={6}>
            <BotUserPermissions access={access} userId={user.userId} t={t} />
          </Box>
        </Box>
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
