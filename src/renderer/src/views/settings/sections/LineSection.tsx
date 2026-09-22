import React, { useEffect, useState } from 'react';
import { Box, Group, Stack, Text, Button as MButton } from '@mantine/core';
import { KeyRound, Lock, MessageSquare, Plug, RefreshCw, Server, Users } from 'lucide-react';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { AppButton } from '../../../components/AppButton';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SectionCard, SettingRow, SettingField, SettingDivider, ToggleSwitch, SectionTitle } from '../components';
import { BotLlmDirectSetting } from './BotLlmDirectSetting';
import { BotReplyPreview } from './BotReplyPreview';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { LineAccountAlerts } from './LineAccountAlerts';
import { LinePairingPanel } from './LinePairingPanel';
import { LinePairedUsers } from './LinePairedUsers';
import { LineWebhookGuide } from './LineWebhookGuide';
import type { useLineSettings } from '../hooks/useLineSettings';

type LineSettings = ReturnType<typeof useLineSettings>;

function getLineRuntimeColor(status?: string): string {
  switch (status) {
    case 'running': return 'var(--mantine-color-success)';
    case 'error': return 'var(--mantine-color-error)';
    case 'starting': return 'var(--mantine-color-warning)';
    default: return 'var(--mantine-color-dimmed)';
  }
}

function getLineRuntimeLabel(t: (k: string) => string, status?: string): string {
  switch (status) {
    case 'starting': return t('settings.line.status.starting');
    case 'running': return t('settings.line.status.running');
    case 'error': return t('settings.line.status.error');
    default: return t('settings.line.status.idle');
  }
}

interface Props {
  line: LineSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const LineSection: React.FC<Props> = ({ line, t, showSection, isSearching, sectionGap }) => {
  const settings = line.lineSettings;
  const runtimeStatus = settings?.runtime.status;
  const account = settings?.runtime.account;
  const [portDraft, setPortDraft] = useState<number | string>(settings?.port ?? 3007);
  const expanded = (settings?.enabled ?? false) || isSearching;

  useEffect(() => {
    if (settings?.port !== undefined) setPortDraft(settings.port);
  }, [settings?.port]);

  return (
    <Box display={showSection(TAG_SETS.bots, 'bots') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <Group justify="space-between" align="center">
          <Group gap={8} align="center">
            <MessageSquare size={18} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
            <Text fz="var(--font-size-xl)" fw={700} c="var(--mantine-color-default-color)">LINE</Text>
          </Group>
          <Group gap={6} align="center">
            <Box w={7} h={7} bg={getLineRuntimeColor(runtimeStatus)} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text fz="var(--font-size-sm)" fw={600} c={getLineRuntimeColor(runtimeStatus)}>
              {getLineRuntimeLabel(t, runtimeStatus)}
            </Text>
          </Group>
        </Group>

        <SettingDivider my={16} />

        <SecretHealthAlert scopes={['line']} />

        {expanded && (
          <>
            <SectionTitle icon={<Plug size={15} />} label={t('settings.line.section.connection')} />
            <Text fz="var(--font-size-base)" c="dimmed" lh={1.6} mb={12}>
              {t('settings.line.hint')}
            </Text>
          </>
        )}

        <SettingRow
          icon={<MessageSquare size={13} />}
          label={t('settings.line.enabled')}
          hint={expanded ? undefined : t('settings.line.enabled.offHint')}
          control={
            <ToggleSwitch
              checked={settings?.enabled ?? false}
              onChange={() => { void line.handleToggleLineEnabled(); }}
            />
          }
        />

        {expanded && (
          <>
            <Stack gap={12} mt={12}>
              <SettingField icon={<KeyRound size={13} />} label={t('settings.line.tokenLabel')}>
                <AppPasswordInput
                  tone="body"
                  mono
                  value={line.lineTokenInput}
                  onChange={(e) => line.setLineTokenInput(e.target.value)}
                  placeholder={t('settings.line.tokenPlaceholder')}
                />
                <Text fz="var(--font-size-sm)" c="dimmed">
                  {t('settings.line.tokenCurrent')}:{' '}
                  {settings?.hasChannelAccessToken
                    ? (settings.channelAccessTokenPreview || '****')
                    : t('settings.line.notSet')}
                </Text>
              </SettingField>

              <SettingField icon={<Lock size={13} />} label={t('settings.line.secretLabel')}>
                <AppPasswordInput
                  tone="body"
                  mono
                  value={line.lineSecretInput}
                  onChange={(e) => line.setLineSecretInput(e.target.value)}
                  placeholder={t('settings.line.secretPlaceholder')}
                />
                <Text fz="var(--font-size-sm)" c="dimmed">
                  {t('settings.line.secretCurrent')}:{' '}
                  {settings?.hasChannelSecret
                    ? (settings.channelSecretPreview || '****')
                    : t('settings.line.notSet')}
                </Text>
              </SettingField>

              <Group justify="flex-end">
                <MButton
                  variant="default"
                  leftSection={<KeyRound size={13} />}
                  onClick={() => { void line.handleSaveLineCredentials(); }}
                  disabled={line.lineBusy || (!line.lineTokenInput.trim() && !line.lineSecretInput.trim())}
                >
                  {t('settings.line.saveCredentials')}
                </MButton>
              </Group>

              {settings?.runtime.errorMessage && (
                <Box
                  p="8px 10px"
                  bg="var(--mantine-color-bg-tertiary)"
                  style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
                >
                  <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)">
                    {settings.runtime.errorMessage}
                  </Text>
                </Box>
              )}
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<Server size={15} />} label={t('settings.line.section.webhook')} />
            <Stack gap={12}>
              <SettingField icon={<Server size={13} />} label={t('settings.line.portLabel')}>
                <Group gap={8} align="center">
                  <AppNumberInput
                    w={140}
                    tone="body"
                    min={1}
                    max={65535}
                    allowDecimal={false}
                    value={portDraft}
                    onChange={setPortDraft}
                  />
                  <MButton
                    variant="default"
                    onClick={() => { void line.handleUpdateLinePort(Number(portDraft)); }}
                    disabled={line.lineBusy || !Number(portDraft)}
                  >
                    {t('settings.line.savePort')}
                  </MButton>
                </Group>
              </SettingField>

              {settings && (
                <LineWebhookGuide port={settings.port} webhookPath={settings.webhookPath} t={t} />
              )}
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<MessageSquare size={15} />} label={t('settings.line.section.reply')} />
            <Stack gap={12}>
              <BotReplyPreview
                compactReply
                mode="markdown"
                note={t('settings.line.reply.note')}
                t={t}
              />

              <SettingDivider my={4} />

              {settings && (
                <BotLlmDirectSetting
                  value={settings.llmDirect}
                  busy={line.lineBusy}
                  hint={t('settings.line.llmDirect.hint')}
                  onUpdate={(patch) => { void line.handleUpdateLineLlmDirect(patch); }}
                  t={t}
                />
              )}
            </Stack>

            <SettingDivider my={16} />

            <SectionTitle icon={<Users size={15} />} label={t('settings.line.section.access')} />
            <Stack gap={12}>
              <Group justify="space-between" align="center" gap={8}>
                <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">
                  {account
                    ? `${account.displayName} · ${account.basicId}`
                    : t('settings.line.account.unknown')}
                </Text>
                <AppButton
                  variant="default"
                  size="compact-sm"
                  leftSection={<RefreshCw size={13} />}
                  loading={line.lineAccountBusy}
                  onClick={() => { void line.handleRefreshLineAccount(); }}
                  disabled={runtimeStatus !== 'running'}
                >
                  {t('settings.line.account.refresh')}
                </AppButton>
              </Group>

              <LineAccountAlerts account={account} t={t} />

              <LinePairingPanel
                pendingCodes={settings?.pairing.pendingCodes ?? []}
                account={account}
                busy={line.lineBusy}
                onGenerate={() => { void line.handleGenerateLinePairingCode(); }}
                onRevoke={(code) => { void line.handleRevokeLinePairingCode(code); }}
                t={t}
              />

              <SettingDivider my={4} />

              <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">
                {t('settings.line.paired.title')}
              </Text>
              <LinePairedUsers
                pairedUsers={settings?.pairing.pairedUsers ?? []}
                onUnpair={(userId) => { void line.handleUnpairLineUser(userId); }}
                t={t}
              />
            </Stack>
          </>
        )}
      </SectionCard>
    </Box>
  );
};
