import React, { useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';

import { WebDialog } from '../../../components/WebDialog';
import { BotUserPermissions, UnpairButton } from './BotUserPermissions';
import type { BotAccessControls } from '../hooks/useBotAccessControls';
import type { LinePairedUser } from '../../../../../shared/types';

/** The list's words, already translated: each platform with string ids says them its own way. */
export interface PairedUsersCopy {
  empty: string;
  unknownName: string;
  remove: string;
  removeTitle: string;
}

interface Props {
  pairedUsers: LinePairedUser[];
  access: BotAccessControls;
  onUnpair: (userId: string) => void;
  t: (key: string) => string;
  /** Absent = LINE's wording. */
  copy?: PairedUsersCopy;
}

/** The paired accounts of a platform with string ids (LINE, Discord, Slack), each with its grants. */
export const LinePairedUsers: React.FC<Props> = ({ pairedUsers, access, onUnpair, t, copy }) => {
  // Confirmed like other permanent removals: unpairing revokes the account's bot access.
  const [pending, setPending] = useState<LinePairedUser | null>(null);
  const words: PairedUsersCopy = copy ?? {
    empty: t('settings.line.paired.empty'),
    unknownName: t('settings.line.paired.unknownName'),
    remove: t('settings.line.paired.remove'),
    removeTitle: t('settings.line.paired.remove.title'),
  };
  if (pairedUsers.length === 0) {
    return <Text fz="var(--font-size-sm)" c="dimmed">{words.empty}</Text>;
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
                {user.displayName || words.unknownName}
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
            <UnpairButton label={words.remove} onClick={() => setPending(user)} />
          </Group>
          <Box mt={6}>
            <BotUserPermissions access={access} userId={user.userId} t={t} />
          </Box>
        </Box>
      ))}

      <WebDialog
        open={pending !== null}
        title={words.removeTitle}
        description={pending?.displayName || pending?.userId || ''}
        confirmText={words.remove}
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
