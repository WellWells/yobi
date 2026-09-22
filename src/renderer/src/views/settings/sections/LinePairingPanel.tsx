import React, { useEffect, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip, Button as MButton } from '@mantine/core';
import { Link2, Trash2, UserPlus } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { CopyIconButton } from '../../../components/CopyIconButton';

import type { LineAccountInfo, LinePendingCodeView } from '../../../../../shared/types';

interface Props {
  pendingCodes: LinePendingCodeView[];
  account?: LineAccountInfo;
  busy: boolean;
  onGenerate: () => void;
  onRevoke: (code: string) => void;
  t: (key: string) => string;
}

function formatRemaining(expiresAt: string, now: number): string {
  const remainingMs = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '0:00';
  const totalSeconds = Math.floor(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const LinePairingPanel: React.FC<Props> = ({ pendingCodes, account, busy, onGenerate, onRevoke, t }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (pendingCodes.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingCodes.length]);

  return (
    <Stack gap={12}>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.line.pairing.hint')}</Text>

      {account?.addFriendUrl && (
        <Group gap={8} align="center">
          <AppTextInput flex={1} tone="body" mono readOnly value={account.addFriendUrl} aria-label={t('settings.line.pairing.addFriend')} />
          <CopyIconButton
            value={account.addFriendUrl}
            copyLabel={t('settings.line.pairing.copyAddFriend')}
            copiedLabel={t('settings.line.pairing.copied')}
          />
        </Group>
      )}

      <Group gap={8} align="center">
        <MButton
          variant="default"
          leftSection={<UserPlus size={13} />}
          onClick={onGenerate}
          disabled={busy || !account}
        >
          {t('settings.line.pairing.generate')}
        </MButton>
        {!account && (
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.line.pairing.accountRequired')}</Text>
        )}
      </Group>

      {pendingCodes.length === 0 ? (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.line.pairing.empty')}</Text>
      ) : (
        <Stack gap={8}>
          {pendingCodes.map((pending) => (
            <Box
              key={pending.code}
              p="8px 10px"
              bg="var(--mantine-color-bg-tertiary)"
              style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
            >
              <Group justify="space-between" align="center" gap={8}>
                <Group gap={10} align="center">
                  {/* Inherits the surrounding size on purpose: the fz here used to name an
                      undefined --font-size-lg, so it has always rendered inherited. */}
                  <Text fw={700} ff="var(--font-mono)" c="var(--mantine-color-default-color)">
                    {pending.code}
                  </Text>
                  <Text fz="var(--font-size-sm)" c="dimmed">
                    {t('settings.line.pairing.expiresIn')} {formatRemaining(pending.expiresAt, now)}
                  </Text>
                </Group>
                <Tooltip label={t('settings.line.pairing.revoke')} position="top">
                  <ActionIcon
                    variant="subtle"
                    size={26}
                    onClick={() => onRevoke(pending.code)}
                    aria-label={t('settings.line.pairing.revoke')}
                  >
                    <Trash2 size={13} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {pending.deepLink && (
                <Group gap={8} align="center" mt={8}>
                  <Link2 size={13} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
                  <AppTextInput flex={1} tone="body" mono readOnly value={pending.deepLink} aria-label={t('settings.line.pairing.deepLink')} />
                  <CopyIconButton
                    value={pending.deepLink}
                    copyLabel={t('settings.line.pairing.copyLink')}
                    copiedLabel={t('settings.line.pairing.copied')}
                  />
                </Group>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
