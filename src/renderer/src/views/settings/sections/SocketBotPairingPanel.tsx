import React, { useEffect, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip, Button as MButton } from '@mantine/core';
import { Trash2, UserPlus } from 'lucide-react';
import { CopyIconButton } from '../../../components/CopyIconButton';
import type { PendingPairingCode } from '../../../../../shared/types';
import { formatRemaining } from './LinePairingPanel';

interface Props {
  pendingCodes: PendingPairingCode[];
  /** The bot is connected: a code is only useful once someone can send it. */
  connected: boolean;
  busy: boolean;
  onGenerate: () => void;
  onRevoke: (code: string) => void;
  t: (key: string) => string;
}

/** Pairing codes for Discord and Slack: each shown as the `/pair` line to send the bot, ready to copy. */
export const SocketBotPairingPanel: React.FC<Props> = ({ pendingCodes, connected, busy, onGenerate, onRevoke, t }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (pendingCodes.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingCodes.length]);

  return (
    <Stack gap={12}>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.socketBot.pairing.hint')}</Text>
      <Group gap={8} align="center">
        <MButton variant="default" leftSection={<UserPlus size={13} />} onClick={onGenerate} disabled={busy || !connected}>
          {t('settings.socketBot.pairing.generate')}
        </MButton>
        {!connected && <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.socketBot.pairing.connectFirst')}</Text>}
      </Group>
      {pendingCodes.length === 0 ? (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.socketBot.pairing.empty')}</Text>
      ) : (
        <Stack gap={8}>
          {pendingCodes.map((pending) => {
            const line = `/pair ${pending.code}`;
            return (
              <Box
                key={pending.code}
                p="8px 10px"
                bg="var(--mantine-color-bg-tertiary)"
                style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
              >
                <Group justify="space-between" align="center" gap={8} wrap="nowrap">
                  <Group gap={10} align="center" wrap="nowrap">
                    <Text fw={700} ff="var(--font-mono)" c="var(--mantine-color-default-color)">{line}</Text>
                    <Text fz="var(--font-size-sm)" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {t('settings.socketBot.pairing.expiresIn')} {formatRemaining(pending.expiresAt, now)}
                    </Text>
                  </Group>
                  <Group gap={2} wrap="nowrap">
                    <CopyIconButton value={line} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
                    <Tooltip label={t('settings.socketBot.pairing.revoke')} position="top">
                      <ActionIcon variant="subtle" size={26} onClick={() => onRevoke(pending.code)} aria-label={t('settings.socketBot.pairing.revoke')}>
                        <Trash2 size={13} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </Box>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
};
