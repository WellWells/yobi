import React from 'react';
import { Box, Group, Stack, Text, Button as MButton } from '@mantine/core';
import { Bot, KeyRound, Link, Megaphone, MessageSquare, Plug, Send, Users, UsersRound } from 'lucide-react';
import dayjs from 'dayjs';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { SectionCard, SettingRow, SettingField, SettingDivider, SelectDropdown, ToggleSwitch, SectionTitle } from '../components';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { BotDefaultModelSetting } from './BotDefaultModelSetting';
import { BotReplyPreview } from './BotReplyPreview';
import { TelegramChannels } from './TelegramChannels';
import { BotAudienceSection } from './BotAudienceSection';
import { TelegramPairingPanel } from './TelegramPairingPanel';
import { TelegramPairedUsers } from './TelegramPairedUsers';
import { TelegramLargeUploadSettings } from './TelegramLargeUploadSettings';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useTelegramSettings } from '../hooks/useTelegramSettings';
import type { BotAccessControls } from '../hooks/useBotAccessControls';

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
  /** Each paired account's grants and owner mark, edited under its row. */
  access: BotAccessControls;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const TelegramSection: React.FC<Props> = ({
  telegram, access, t, showSection, isSearching, sectionGap,
}) => {
  const settings = telegram.telegramSettings;
  const runtimeStatus = settings?.runtime.status;
  const channels = settings?.channels ?? [];
  const pendingCodes = settings?.pairing.pendingCodes ?? [];
  const pairedUsers = settings?.pairing.pairedUsers ?? [];
  const expanded = (settings?.enabled ?? false) || isSearching;

  return (
    <Box display={showSection(TAG_SETS.telegram, 'bots') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <Group justify="space-between" align="center">
          <Group gap={8} align="center">
            <Send size={18} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
            <Text fz="var(--font-size-xl)" fw={700} c="var(--mantine-color-default-color)">Telegram</Text>
          </Group>
          {/* Hidden when off: the switch says so, and an idle dot would read as "on, waiting". */}
          <Group gap={6} align="center" display={settings?.enabled ? 'flex' : 'none'}>
            <Box w={7} h={7} bg={getTelegramRuntimeColor(runtimeStatus)} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text fz="var(--font-size-sm)" fw={600} c={getTelegramRuntimeColor(runtimeStatus)}>
              {getTelegramRuntimeLabel(t, runtimeStatus)}
            </Text>
          </Group>
        </Group>

        <SettingDivider my={16} />

        <SecretHealthAlert scopes={['telegram']} />

        {expanded && (
          <>
            <SectionTitle icon={<Plug size={15} />} label={t('settings.telegram.section.connection')} />
            <Text fz="var(--font-size-base)" c="dimmed" lh={1.6} mb={12}>
              {t('settings.telegram.hint')}
            </Text>
          </>
        )}

        <SettingRow
          icon={<Bot size={13} />}
          label={t('settings.telegram.enabled')}
          hint={expanded ? undefined : t('settings.telegram.enabled.offHint')}
          control={
            <ToggleSwitch
              checked={settings?.enabled ?? false}
              onChange={() => { void telegram.handleToggleTelegramEnabled(); }}
            />
          }
        />

        {expanded && (
          <>
            <Stack gap={12} mt={12}>
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

            <TelegramLargeUploadSettings
              saved={settings?.largeUpload}
              reload={telegram.loadTelegramSettings}
              t={t}
            />

            <SettingDivider my={16} />

            <SectionTitle icon={<Users size={15} />} label={t('settings.telegram.section.access')} />
            <Stack gap={12}>
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

              <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
                {t('settings.telegram.pairing.howto')}
              </Text>

              <TelegramPairingPanel
                pendingCodes={pendingCodes}
                formatExpiry={(expiresAt) => dayjs(expiresAt).format('HH:mm:ss')}
                onOpen={(code) => { void telegram.handleOpenTelegramStart(code); }}
                onCopyCode={(code) => { void telegram.handleCopyPairingCode(code); }}
                onCopyLink={(code) => { void telegram.handleCopyTelegramStartUrl(code); }}
                onRevoke={(code) => { void telegram.handleRevokePairingCode(code); }}
                t={t}
              />

              <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">
                {t('settings.telegram.paired.title')}
              </Text>

              <Stack gap={4}>
                <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
                  {t('settings.bot.perm.pairedHint')}
                </Text>
                <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
                  {t('settings.telegram.admin.explain')}
                </Text>
              </Stack>

              <TelegramPairedUsers
                pairedUsers={pairedUsers}
                contacts={settings?.contacts ?? []}
                access={access}
                onUnpair={(userId) => { void telegram.handleUnpairTelegramUser(userId); }}
                t={t}
              />
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<MessageSquare size={15} />} label={t('settings.telegram.section.reply')} />
            <Stack gap={12}>
              <SettingRow
                icon={<MessageSquare size={13} />}
                label={t('settings.telegram.compactReply')}
                hint={t('settings.telegram.compactReply.hint')}
                control={
                  <ToggleSwitch
                    checked={settings?.compactReply ?? false}
                    onChange={() => { void telegram.handleToggleTelegramCompactReply(); }}
                  />
                }
              />

              {!settings?.compactReply && (
                <Box maw={300}>
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
              )}

              <BotReplyPreview
                compactReply={settings?.compactReply ?? false}
                mode={settings?.defaultReplyMode ?? 'markdown'}
                t={t}
              />

              <SettingDivider my={4} />

              {settings && (
                <BotDefaultModelSetting
                  value={settings.llmDirect}
                  busy={telegram.telegramBusy}
                  hint={t('settings.telegram.defaultModel.hint')}
                  onUpdate={(patch) => { void telegram.handleUpdateTelegramLlmDirect(patch); }}
                  t={t}
                />
              )}
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<Megaphone size={15} />} label={t('settings.telegram.channels.title')} />
            <TelegramChannels
              channels={channels}
              contacts={settings?.contacts ?? []}
              onForget={(chatId) => { void telegram.handleForgetTelegramChannel(chatId); }}
              t={t}
            />
            <Box mt={12}>
              <SettingRow
                icon={<Users size={13} />}
                label={t('settings.telegram.allowGroup')}
                hint={settings?.allowGroupCommands && settings.runtime.readsAllGroupMessages === false
                  ? t('settings.telegram.groupPrivacyHint')
                  : undefined}
                control={
                  <ToggleSwitch
                    checked={settings?.allowGroupCommands ?? false}
                    onChange={() => { void telegram.handleToggleTelegramGroupCommands(); }}
                  />
                }
              />
            </Box>

            <SettingDivider my={16} />

            <SectionTitle icon={<UsersRound size={15} />} label={t('settings.bot.group.title')} />
            <BotAudienceSection platform="telegram" connectors={access.connectors} refreshKey={settings} t={t} />
          </>
        )}
      </SectionCard>
    </Box>
  );
};
