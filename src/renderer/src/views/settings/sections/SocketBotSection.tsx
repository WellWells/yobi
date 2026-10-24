import React from 'react';
import { Box, Group, Stack, Text, Button as MButton } from '@mantine/core';
import { KeyRound, MessageSquare, Plug, RefreshCw, Users, UsersRound } from 'lucide-react';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { AppButton } from '../../../components/AppButton';
import { SectionCard, SettingRow, SettingField, SettingDivider, ToggleSwitch, SectionTitle } from '../components';
import { BotDefaultModelSetting } from './BotDefaultModelSetting';
import { BotAskTtlSetting } from './BotAskTtlSetting';
import type { BotCommandsControls } from './BotAskTtlSetting';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { BOT_PLATFORM_NAMES, SOCKET_BOT_SECRET_FIELDS } from '../../../../../shared/types';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { LinePairedUsers } from './LinePairedUsers';
import { BotDefaultGrants } from './BotUserPermissions';
import { BotAudienceSection } from './BotAudienceSection';
import { SocketBotPairingPanel } from './SocketBotPairingPanel';
import { SocketBotSetupGuide } from './SocketBotSetupGuide';
import { ExternalLink } from './lineLinks';
import type { SocketBotSettingsControls } from '../hooks/useSocketBotSettings';
import type { BotAccessControls } from '../hooks/useBotAccessControls';

function runtimeColor(status?: string): string {
  switch (status) {
    case 'running': return 'var(--mantine-color-success)';
    case 'error': return 'var(--mantine-color-error)';
    case 'starting': return 'var(--mantine-color-warning)';
    default: return 'var(--mantine-color-dimmed)';
  }
}

function runtimeLabel(t: (k: string) => string, status?: string): string {
  switch (status) {
    case 'starting': return t('settings.socketBot.status.starting');
    case 'running': return t('settings.socketBot.status.running');
    case 'error': return t('settings.socketBot.status.error');
    default: return t('settings.socketBot.status.idle');
  }
}

interface Props {
  bot: SocketBotSettingsControls;
  /** Each paired account's grants and owner mark, edited under its row. */
  access: BotAccessControls;
  /** The shared commands config; its answer window is shown in this card's reply section. */
  botCommands?: BotCommandsControls;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

/**
 * Discord's or Slack's card: connect with the platform's token(s), pair accounts with a code, then
 * the same grants, groups and reply settings as the other bots. Only the token fields and the setup
 * guide differ between the two.
 */
export const SocketBotSection: React.FC<Props> = ({ bot, access, botCommands, t, showSection, isSearching, sectionGap }) => {
  const { platform, settings } = bot;
  const name = BOT_PLATFORM_NAMES[platform];
  const runtime = settings?.runtime;
  const account = runtime?.account;
  const expanded = (settings?.enabled ?? false) || isSearching;
  const fields = SOCKET_BOT_SECRET_FIELDS[platform];
  const typed = fields.some((field) => bot.secretInputs[field]?.trim());

  return (
    <Box display={showSection(TAG_SETS[platform], 'bots') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <Group justify="space-between" align="center">
          <Group gap={8} align="center">
            <MessageSquare size={18} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
            <Text fz="var(--font-size-xl)" fw={700} c="var(--mantine-color-default-color)">{name}</Text>
          </Group>
          <Group gap={6} align="center" display={settings?.enabled ? 'flex' : 'none'}>
            <Box w={7} h={7} bg={runtimeColor(runtime?.status)} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text fz="var(--font-size-sm)" fw={600} c={runtimeColor(runtime?.status)}>{runtimeLabel(t, runtime?.status)}</Text>
          </Group>
        </Group>

        <SettingDivider my={16} />

        <SecretHealthAlert scopes={[platform]} />

        {expanded && (
          <>
            <SectionTitle icon={<Plug size={15} />} label={t('settings.socketBot.section.connection')} />
            <Text fz="var(--font-size-base)" c="dimmed" lh={1.6} mb={12}>
              {platform === 'discord' ? t('settings.discord.hint') : t('settings.slack.hint')}
            </Text>
            <Box mb={12}>
              <SocketBotSetupGuide platform={platform} t={t} />
            </Box>
          </>
        )}

        <SettingRow
          label={fillTemplate(t('settings.socketBot.enabled'), { platform: name })}
          hint={expanded ? undefined : t('settings.socketBot.enabled.offHint')}
          control={<ToggleSwitch checked={settings?.enabled ?? false} onChange={() => { void bot.toggleEnabled(); }} />}
        />

        {expanded && (
          <>
            <Stack gap={12} mt={12}>
              {fields.map((field) => {
                const saved = settings?.secrets[field];
                return (
                  <SettingField key={field} label={t(`settings.socketBot.secret.${platform}.${field}`)}>
                    <AppPasswordInput
                      tone="body"
                      mono
                      value={bot.secretInputs[field] ?? ''}
                      onChange={(e) => bot.setSecretInput(field, e.target.value)}
                      placeholder={t('settings.socketBot.secretPlaceholder')}
                    />
                    <Text fz="var(--font-size-sm)" c="dimmed">
                      {fillTemplate(t('settings.socketBot.secretCurrent'), {
                        value: saved?.has ? (saved.preview || '****') : t('settings.socketBot.notSet'),
                      })}
                    </Text>
                  </SettingField>
                );
              })}

              <Group justify="flex-end" gap={8}>
                {runtime?.status === 'error' && (
                  <AppButton variant="default" leftSection={<RefreshCw size={13} />} loading={bot.busy} onClick={() => { void bot.reconnect(); }}>
                    {t('settings.socketBot.reconnect')}
                  </AppButton>
                )}
                <MButton
                  variant="default"
                  leftSection={<KeyRound size={13} />}
                  onClick={() => { void bot.saveSecrets(); }}
                  disabled={bot.busy || !typed}
                >
                  {t('settings.socketBot.saveSecrets')}
                </MButton>
              </Group>

              {runtime?.errorMessage && (
                <Box
                  p="8px 10px"
                  bg="var(--mantine-color-bg-tertiary)"
                  style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
                >
                  <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)">{runtime.errorMessage}</Text>
                </Box>
              )}
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<Users size={15} />} label={t('settings.socketBot.section.access')} />
            <Stack gap={12}>
              <Group justify="space-between" align="center" gap={8}>
                <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">
                  {account
                    ? [account.name, account.workspace].filter(Boolean).join(' · ')
                    : t('settings.socketBot.account.unknown')}
                </Text>
                {account?.inviteUrl && <ExternalLink url={account.inviteUrl} label={t('settings.discord.invite')} />}
              </Group>

              <SocketBotPairingPanel
                pendingCodes={settings?.pairing.pendingCodes ?? []}
                connected={runtime?.status === 'running'}
                busy={bot.busy}
                onGenerate={() => { void bot.generatePairingCode(); }}
                onRevoke={(code) => { void bot.revokePairingCode(code); }}
                t={t}
              />

              <BotDefaultGrants access={access} t={t} />

              <SettingDivider my={4} />

              <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">{t('settings.socketBot.paired.title')}</Text>
              <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.bot.perm.pairedHint')}</Text>
              <LinePairedUsers
                pairedUsers={settings?.pairing.pairedUsers ?? []}
                access={access}
                onUnpair={(userId) => { void bot.unpairUser(userId); }}
                t={t}
                copy={{
                  empty: t('settings.socketBot.paired.empty'),
                  unknownName: t('settings.socketBot.paired.unknownName'),
                  remove: t('settings.socketBot.paired.remove'),
                  removeTitle: t('settings.socketBot.paired.removeTitle'),
                }}
              />
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<UsersRound size={15} />} label={t('settings.bot.group.title')} />
            <BotAudienceSection platform={platform} connectors={access.connectors} refreshKey={settings} t={t} />

            <SettingDivider my={16} />

            <SectionTitle icon={<MessageSquare size={15} />} label={t('settings.socketBot.section.reply')} />
            <Stack gap={12}>
              {settings && (
                <BotDefaultModelSetting
                  value={settings.llmDirect}
                  busy={bot.busy}
                  hint={t('settings.socketBot.defaultModel.hint')}
                  onUpdate={(patch) => { void bot.updateLlmDirect(patch); }}
                  t={t}
                />
              )}
              {botCommands && <BotAskTtlSetting botCommands={botCommands} t={t} />}
            </Stack>
          </>
        )}
      </SectionCard>
    </Box>
  );
};
