import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Button as MButton } from '@mantine/core';
import {
  Bot, Copy, ExternalLink, KeyRound, Link, ShieldAlert, Unlink, Users,
} from 'lucide-react';
import dayjs from 'dayjs';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { SectionCard, SettingRow, SelectDropdown, ToggleSwitch, GroupHeader, SectionTitle } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useTelegramSettings } from '../hooks/useTelegramSettings';

type TelegramSettings = ReturnType<typeof useTelegramSettings>;

function getTelegramRuntimeColor(status?: string): string {
  switch (status) {
    case 'running': return 'var(--mantine-color-success)';
    case 'error': return 'var(--mantine-color-error)';
    case 'starting':
    case 'stopping': return 'var(--mantine-color-warning)';
    default: return 'var(--mantine-color-dimmed)';
  }
}

function getTelegramRuntimeLabel(t: (k: string) => string, status?: string): string {
  switch (status) {
    case 'starting': return t('settings.telegram.status.starting');
    case 'running': return t('settings.telegram.status.running');
    case 'stopping': return t('settings.telegram.status.stopping');
    case 'error': return t('settings.telegram.status.error');
    default: return t('settings.telegram.status.idle');
  }
}

interface Props {
  telegram: TelegramSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'telegram') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const TelegramSection: React.FC<Props> = ({
  telegram, t, showSection, isSearching, sectionGap,
}) => (
  <Box>
    {isSearching && <GroupHeader label={t('settings.group.telegram')} />}

    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.telegram, 'telegram') ? 'block' : 'none' }}>
      <SectionTitle icon={<Bot size={15} />} label={t('settings.telegram.title')} mb={6} />
      <Text fz="var(--font-size-base)" c="dimmed" lh={1.6} mb={12}>
        {t('settings.telegram.hint')}
      </Text>

      <Stack gap={12}>
        {/* Enable/disable bot */}
        <SettingRow
          icon={<Bot size={13} />}
          label={t('settings.telegram.enabled')}
          control={
            <ToggleSwitch
              checked={telegram.telegramSettings?.enabled ?? false}
              onChange={() => { void telegram.handleToggleTelegramEnabled(); }}
            />
          }
        />

        {/* Allow group commands */}
        <SettingRow
          icon={<Users size={13} />}
          label={t('settings.telegram.allowGroup')}
          control={
            <ToggleSwitch
              checked={telegram.telegramSettings?.allowGroupCommands ?? false}
              onChange={() => { void telegram.handleToggleTelegramGroupCommands(); }}
            />
          }
        />

        {/* Default reply mode */}
        <Box>
          <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" mb={6}>
            {t('settings.telegram.defaultReply')}
          </Text>
          <SelectDropdown
            value={telegram.telegramSettings?.defaultReplyMode ?? 'markdown'}
            options={[
              { value: 'markdown', label: t('settings.telegram.reply.markdown') },
              { value: 'png', label: t('settings.telegram.reply.png') },
              { value: 'webp', label: t('settings.telegram.reply.webp') },
              { value: 'pdf', label: t('settings.telegram.reply.pdf') },
            ]}
            onChange={(v) => { void telegram.handleTelegramDefaultReplyMode(v as 'markdown' | 'png' | 'webp' | 'pdf'); }}
            disabled={telegram.telegramBusy}
          />
        </Box>

        {/* Bot token input */}
        <Group gap={8} align="center">
          <AppPasswordInput
            flex={1}
            tone="body"
            mono
            value={telegram.telegramTokenInput}
            onChange={(e) => telegram.setTelegramTokenInput(e.target.value)}
            placeholder={t('settings.telegram.tokenPlaceholder')}
          />
          <MButton
            variant="default"
            leftSection={<KeyRound size={13} />}
            onClick={() => { void telegram.handleSaveTelegramToken(); }}
            disabled={telegram.telegramBusy || !telegram.telegramTokenInput.trim()}
          >
            {t('settings.telegram.saveToken')}
          </MButton>
        </Group>

        <Text fz="var(--font-size-sm)" c="dimmed">
          {t('settings.telegram.tokenCurrent')}:{' '}
          {telegram.telegramSettings?.hasToken
            ? (telegram.telegramSettings.tokenPreview ?? '****')
            : t('settings.telegram.tokenNotSet')}
        </Text>

        {/* Runtime status */}
        <Box
          p="8px 10px"
          bg="var(--mantine-color-bg-tertiary)"
          style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
        >
          <Group gap={8} align="center">
            <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)">
              {t('settings.telegram.runtime')}:
            </Text>
            <Text
              fz="var(--font-size-base)"
              fw={700}
              c={getTelegramRuntimeColor(telegram.telegramSettings?.runtime.status)}
            >
              {getTelegramRuntimeLabel(t, telegram.telegramSettings?.runtime.status)}
            </Text>
          </Group>
          {telegram.telegramSettings?.runtime.botUsername && (
            <Text fz="var(--font-size-sm)" c="dimmed" mt={4}>
              @{telegram.telegramSettings.runtime.botUsername}
            </Text>
          )}
          {telegram.telegramSettings?.runtime.errorMessage && (
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" mt={4}>
              {telegram.telegramSettings.runtime.errorMessage}
            </Text>
          )}
        </Box>

        {/* Pairing codes */}
        <Group justify="space-between" align="center">
          <Text fz="var(--font-size-base)" fw={700} c="var(--mantine-color-default-color)">
            {t('settings.telegram.pairing.title')}
          </Text>
          <MButton
            variant="default"
            leftSection={<Link size={13} />}
            onClick={() => { void telegram.handleGeneratePairingCode(); }}
            disabled={telegram.telegramBusy}
          >
            {t('settings.telegram.pairing.generate')}
          </MButton>
        </Group>

        <Text fz="var(--font-size-sm)" c="dimmed">
          {t('settings.telegram.pairing.pending')}: {telegram.telegramSettings?.pairing.pendingCodes.length ?? 0}
          {' · '}
          {t('settings.telegram.pairing.paired')}: {telegram.telegramSettings?.pairing.pairedUsers.length ?? 0}
          {' · '}
          {t('settings.telegram.admin.count')}: {telegram.telegramSettings?.adminUserIds.length ?? 0}
        </Text>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mt={0}>
          {t('settings.telegram.pairing.howto')}
        </Text>

        {/* Pending codes */}
        {(telegram.telegramSettings?.pairing.pendingCodes.length ?? 0) > 0 && (
          <Stack gap={6}>
            {telegram.telegramSettings!.pairing.pendingCodes.map((item) => (
              <Group
                key={item.code}
                justify="space-between"
                align="center"
                gap={8}
                p="6px 8px"
                bg="var(--mantine-color-bg-tertiary)"
                style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
              >
                <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" ff="var(--font-mono)">
                  {item.code}
                  {' · '}
                  {t('settings.telegram.pairing.expires')}
                  {': '}
                  {dayjs(item.expiresAt).format('HH:mm:ss')}
                </Text>
                <Group gap={4}>
                  <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleCopyPairingCode(item.code); }} title={t('settings.telegram.pairing.copy')}><Copy size={13} /></ActionIcon>
                  <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleOpenTelegramStart(item.code); }} title={t('settings.telegram.pairing.openLink')}><ExternalLink size={13} /></ActionIcon>
                  <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleCopyTelegramStartUrl(item.code); }} title={t('settings.telegram.pairing.copyLink')}><Link size={13} /></ActionIcon>
                  <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleRevokePairingCode(item.code); }} title={t('settings.telegram.pairing.revoke')}><ShieldAlert size={13} /></ActionIcon>
                </Group>
              </Group>
            ))}
          </Stack>
        )}

        {/* Paired users */}
        {(telegram.telegramSettings?.pairing.pairedUsers.length ?? 0) > 0 && (
          <Stack gap={6}>
            {telegram.telegramSettings!.pairing.pairedUsers.map((user) => {
              const isAdmin = telegram.telegramSettings!.adminUserIds.includes(user.userId);
              return (
                <Group
                  key={user.userId}
                  justify="space-between"
                  align="center"
                  gap={8}
                  p="6px 8px"
                  bg="var(--mantine-color-bg-tertiary)"
                  style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
                >
                  <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">
                    {user.firstName || user.lastName ? (
                      `${[user.firstName, user.lastName].filter(Boolean).join(' ')}${user.username ? ` (@${user.username})` : ''}`
                    ) : (
                      user.username ? `@${user.username}` : `ID ${user.userId}`
                    )}
                    {isAdmin ? ` · ${t('settings.telegram.admin.badge')}` : ''}
                  </Text>
                  <Group gap={4}>
                    <ActionIcon
                      variant="subtle" size={26}
                      onClick={() => { void telegram.handleToggleTelegramAdmin(user.userId); }}
                      title={isAdmin ? t('settings.telegram.admin.remove') : t('settings.telegram.admin.add')}
                      c={isAdmin ? 'var(--mantine-color-accent)' : undefined}
                    >
                      <ShieldAlert size={13} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleUnpairTelegramUser(user.userId); }} title={t('settings.telegram.pairing.unpair')}><Unlink size={13} /></ActionIcon>
                  </Group>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </SectionCard>
  </Box>
);
