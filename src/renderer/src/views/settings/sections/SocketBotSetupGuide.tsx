import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { CopyIconButton } from '../../../components/CopyIconButton';
import type { SocketBotPlatform } from '../../../../../shared/types';
import { slackAppManifest } from '../../../../../shared/slackManifest';
import { ExternalLink } from './lineLinks';
import { StepBox } from './LineWebhookGuide';

const DISCORD_PORTAL_URL = 'https://discord.com/developers/applications';
const SLACK_NEW_APP_URL = 'https://api.slack.com/apps?new_app=1';

interface Props {
  platform: SocketBotPlatform;
  t: (key: string) => string;
}

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{children}</Text>
);

const DiscordGuide: React.FC<{ t: Props['t'] }> = ({ t }) => (
  <Stack gap={12}>
    <StepBox step={1} label={t('settings.discord.guide.step1')}>
      <Hint>{t('settings.discord.guide.step1Hint')}</Hint>
      <Group gap={14}>
        <ExternalLink url={DISCORD_PORTAL_URL} label={t('settings.discord.guide.openPortal')} />
      </Group>
    </StepBox>
    <StepBox step={2} label={t('settings.discord.guide.step2')}>
      <Hint>{t('settings.discord.guide.step2Hint')}</Hint>
    </StepBox>
    <StepBox step={3} label={t('settings.discord.guide.step3')}>
      <Hint>{t('settings.discord.guide.step3Hint')}</Hint>
    </StepBox>
  </Stack>
);

const SlackGuide: React.FC<{ t: Props['t'] }> = ({ t }) => {
  const manifest = slackAppManifest();
  return (
    <Stack gap={12}>
      <StepBox step={1} label={t('settings.slack.guide.step1')}>
        <Hint>{t('settings.slack.guide.step1Hint')}</Hint>
        <Group gap={8} align="flex-start" wrap="nowrap">
          <AppTextarea
            flex={1}
            tone="body"
            mono
            readOnly
            autosize
            minRows={4}
            maxRows={8}
            value={manifest}
            aria-label={t('settings.slack.guide.manifest')}
          />
          <CopyIconButton value={manifest} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
        </Group>
        <Group gap={14}>
          <ExternalLink url={SLACK_NEW_APP_URL} label={t('settings.slack.guide.openApi')} />
        </Group>
      </StepBox>
      <StepBox step={2} label={t('settings.slack.guide.step2')}>
        <Hint>{t('settings.slack.guide.step2Hint')}</Hint>
      </StepBox>
      <StepBox step={3} label={t('settings.slack.guide.step3')}>
        <Hint>{t('settings.slack.guide.step3Hint')}</Hint>
      </StepBox>
    </Stack>
  );
};

/** How to make the bot on the platform's side, step by step. */
export const SocketBotSetupGuide: React.FC<Props> = ({ platform, t }) => (
  platform === 'discord' ? <DiscordGuide t={t} /> : <SlackGuide t={t} />
);
