import React from 'react';
import { ActionIcon, Group, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { Copy, ExternalLink, Link, EllipsisVertical, CircleX } from 'lucide-react';
import type { TelegramPendingCode } from '../../../../../shared/types';
import { DangerMenuItem } from '../../../components/DangerMenuItem';
import { TooltipTarget } from '../../../components/TooltipTarget';

interface Props {
  pendingCodes: TelegramPendingCode[];
  formatExpiry: (expiresAt: string) => string;
  onOpen: (code: string) => void;
  onCopyCode: (code: string) => void;
  onCopyLink: (code: string) => void;
  onRevoke: (code: string) => void;
  t: (key: string) => string;
}

export const TelegramPairingPanel: React.FC<Props> = ({
  pendingCodes, formatExpiry, onOpen, onCopyCode, onCopyLink, onRevoke, t,
}) => {
  if (pendingCodes.length === 0) return null;

  return (
    <Stack gap={6}>
      {pendingCodes.map((item) => (
        <Group
          key={item.code}
          justify="space-between"
          align="center"
          gap={8}
          p="6px 8px"
          bg="var(--mantine-color-bg-tertiary)"
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
        >
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">
            <Text span inherit ff="var(--font-mono)">{item.code}</Text>
            {' · '}
            {t('settings.telegram.pairing.expires')}
            {': '}
            {formatExpiry(item.expiresAt)}
          </Text>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t('settings.telegram.pairing.openLink')} position="top">
              <ActionIcon
                variant="subtle"
                size={26}
                onClick={() => onOpen(item.code)}
                aria-label={t('settings.telegram.pairing.openLink')}
              >
                <ExternalLink size={13} />
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <TooltipTarget label={t('common.moreActions')} position="bottom">
                  <ActionIcon variant="subtle" size={26} aria-label={t('common.moreActions')}>
                    <EllipsisVertical size={13} />
                  </ActionIcon>
                </TooltipTarget>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Copy size={13} />} onClick={() => onCopyCode(item.code)}>
                  {t('settings.telegram.pairing.copy')}
                </Menu.Item>
                <Menu.Item leftSection={<Link size={13} />} onClick={() => onCopyLink(item.code)}>
                  {t('settings.telegram.pairing.copyLink')}
                </Menu.Item>
                <Menu.Divider />
                <DangerMenuItem leftSection={<CircleX size={13} />} onClick={() => onRevoke(item.code)}>
                  {t('settings.telegram.pairing.revoke')}
                </DangerMenuItem>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      ))}
    </Stack>
  );
};
