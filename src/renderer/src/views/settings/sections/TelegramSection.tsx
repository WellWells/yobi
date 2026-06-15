import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip, Button as MButton } from '@mantine/core';
import {
  Bot, Copy, ExternalLink, KeyRound, Link, Plug, Send, ShieldAlert, Sparkles, Unlink, Users,
} from 'lucide-react';
import dayjs from 'dayjs';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { SectionCard, SettingRow, SettingField, SettingDivider, SelectDropdown, ToggleSwitch, GroupHeader, SectionTitle } from '../components';
import { TelegramProviderCommands } from './TelegramProviderCommands';
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
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const TelegramSection: React.FC<Props> = ({
  telegram, t, showSection, isSearching, sectionGap,
}) => {
  const settings = telegram.telegramSettings;
  const runtimeStatus = settings?.runtime.status;

  return (
    <Box display={showSection(TAG_SETS.bots, 'bots') ? 'block' : 'none'}>
      {isSearching && <GroupHeader label={t('settings.group.bots')} />}

      <SectionCard style={{ marginBottom: sectionGap }}>
        <Group justify="space-between" align="center">
          <Group gap={8} align="center">
            <Send size={18} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
            <Text fz="var(--font-size-xl)" fw={700} c="var(--mantine-color-default-color)">Telegram</Text>
          </Group>
          <Group gap={6} align="center">
            <Box w={7} h={7} bg={getTelegramRuntimeColor(runtimeStatus)} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text fz="var(--font-size-sm)" fw={600} c={getTelegramRuntimeColor(runtimeStatus)}>
              {getTelegramRuntimeLabel(t, runtimeStatus)}
            </Text>
          </Group>
        </Group>

        <SettingDivider my={16} />

        <SectionTitle icon={<Plug size={15} />} label={t('settings.telegram.section.connection')} />
        <Text fz="var(--font-size-base)" c="dimmed" lh={1.6} mb={12}>
          {t('settings.telegram.hint')}
        </Text>
        <Stack gap={12}>
          <SettingRow
            icon={<Bot size={13} />}
            label={t('settings.telegram.enabled')}
            control={
              <ToggleSwitch
                checked={settings?.enabled ?? false}
                onChange={() => { void telegram.handleToggleTelegramEnabled(); }}
              />
            }
          />

          <SettingField icon={<KeyRound size={13} />} label={t('settings.telegram.tokenLabel')}>
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
              {settings?.hasToken
                ? (settings.tokenPreview ?? '****')
                : t('settings.telegram.tokenNotSet')}
            </Text>
          </SettingField>

          {(settings?.runtime.botUsername || settings?.runtime.errorMessage) && (
            <Box
              p="8px 10px"
              bg="var(--mantine-color-bg-tertiary)"
              style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
            >
              {settings?.runtime.botUsername && (
                <Text fz="var(--font-size-sm)" c="dimmed">
                  @{settings.runtime.botUsername}
                </Text>
              )}
              {settings?.runtime.errorMessage && (
                <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" mt={settings?.runtime.botUsername ? 4 : 0}>
                  {settings.runtime.errorMessage}
                </Text>
              )}
            </Box>
          )}
        </Stack>

        <SettingDivider my={16} />

        <SectionTitle icon={<Users size={15} />} label={t('settings.telegram.section.access')} />
        <Stack gap={12}>
          <SettingRow
            icon={<Users size={13} />}
            label={t('settings.telegram.allowGroup')}
            control={
              <ToggleSwitch
                checked={settings?.allowGroupCommands ?? false}
                onChange={() => { void telegram.handleToggleTelegramGroupCommands(); }}
              />
            }
          />

          <SettingDivider />

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
            {t('settings.telegram.pairing.pending')}: {settings?.pairing.pendingCodes.length ?? 0}
            {' · '}
            {t('settings.telegram.pairing.paired')}: {settings?.pairing.pairedUsers.length ?? 0}
            {' · '}
            {t('settings.telegram.admin.count')}: {settings?.adminUserIds.length ?? 0}
          </Text>
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mt={0}>
            {t('settings.telegram.pairing.howto')}
          </Text>

          {(settings?.pairing.pendingCodes.length ?? 0) > 0 && (
            <Stack gap={6}>
              {settings!.pairing.pendingCodes.map((item) => (
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
                    <Tooltip label={t('settings.telegram.pairing.copy')} position="top">
                      <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleCopyPairingCode(item.code); }} aria-label={t('settings.telegram.pairing.copy')}><Copy size={13} /></ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('settings.telegram.pairing.openLink')} position="top">
                      <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleOpenTelegramStart(item.code); }} aria-label={t('settings.telegram.pairing.openLink')}><ExternalLink size={13} /></ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('settings.telegram.pairing.copyLink')} position="top">
                      <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleCopyTelegramStartUrl(item.code); }} aria-label={t('settings.telegram.pairing.copyLink')}><Link size={13} /></ActionIcon>
                    </Tooltip>
                    <Tooltip label={t('settings.telegram.pairing.revoke')} position="top">
                      <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleRevokePairingCode(item.code); }} aria-label={t('settings.telegram.pairing.revoke')}><ShieldAlert size={13} /></ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}

          {(settings?.pairing.pairedUsers.length ?? 0) > 0 && (
            <Stack gap={6}>
              {settings!.pairing.pairedUsers.map((user) => {
                const isAdmin = settings!.adminUserIds.includes(user.userId);
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
                      <Tooltip
                        label={isAdmin ? t('settings.telegram.admin.remove') : t('settings.telegram.admin.add')}
                        position="top"
                      >
                        <ActionIcon
                          variant="subtle" size={26}
                          onClick={() => { void telegram.handleToggleTelegramAdmin(user.userId); }}
                          aria-label={isAdmin ? t('settings.telegram.admin.remove') : t('settings.telegram.admin.add')}
                          c={isAdmin ? 'var(--mantine-color-accent)' : undefined}
                        >
                          <ShieldAlert size={13} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t('settings.telegram.pairing.unpair')} position="top">
                        <ActionIcon variant="subtle" size={26} onClick={() => { void telegram.handleUnpairTelegramUser(user.userId); }} aria-label={t('settings.telegram.pairing.unpair')}><Unlink size={13} /></ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Stack>
      </SectionCard>

      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Sparkles size={15} />} label={t('settings.telegram.commands.title')} />
        <Stack gap={12}>
          <Box>
            <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" mb={6}>
              {t('settings.telegram.defaultReply')}
            </Text>
            <SelectDropdown
              value={settings?.defaultReplyMode ?? 'markdown'}
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

          <SettingDivider />

          {settings && (
            <TelegramProviderCommands
              providerCommands={settings.providerCommands}
              duckaiModels={telegram.duckaiModels}
              busy={telegram.telegramBusy}
              onUpdate={(provider, patch) => { void telegram.handleUpdateProviderCommand(provider, patch); }}
              t={t}
            />
          )}
        </Stack>
      </SectionCard>
    </Box>
  );
};
