import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { CopyIconButton } from '../../../components/CopyIconButton';
import {
  ExternalLink,
  CLOUDFLARED_DOWNLOAD_URL,
  CLOUDFLARE_TUNNEL_GUIDE_URL,
  LINE_DEVELOPERS_CONSOLE_URL,
} from './lineLinks';

interface Props {
  port: number;
  webhookPath: string;
  t: (key: string) => string;
}

const StepBox: React.FC<{ step: number; label: string; children: React.ReactNode }> = ({ step, label, children }) => (
  <Box
    p="10px 12px"
    bg="var(--mantine-color-bg-tertiary)"
    style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
  >
    <Group gap={8} align="center" mb={10} wrap="nowrap">
      <Box
        w={18}
        h={18}
        bg="var(--mantine-color-accent-dim)"
        style={{ borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        <Text fz="var(--font-size-xs)" fw={700} c="var(--mantine-color-accent)" lh={1}>{step}</Text>
      </Box>
      <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">{label}</Text>
    </Group>
    <Stack gap={8}>{children}</Stack>
  </Box>
);

// The tunnel takes the bare origin, while LINE needs that origin's public
// counterpart with the webhook path appended. Showing one merged URL invites
// pasting the wrong half into either field, so each step exposes only its own.
export const LineWebhookGuide: React.FC<Props> = ({ port, webhookPath, t }) => {
  const originUrl = `http://127.0.0.1:${port}`;
  const tunnelCommand = `cloudflared tunnel --url ${originUrl}`;
  const sampleWebhookUrl = `https://${t('settings.line.webhook.publicUrlPlaceholder')}${webhookPath}`;
  const copyLabel = t('common.copy');
  const copiedLabel = t('common.copied');

  return (
    <Stack gap={12}>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.line.webhook.intro')}</Text>

      <StepBox step={1} label={t('settings.line.webhook.step1')}>
        <Group gap={8} align="center">
          <AppTextInput
            flex={1}
            tone="body"
            mono
            readOnly
            value={originUrl}
            aria-label={t('settings.line.webhook.originLabel')}
          />
          <CopyIconButton value={originUrl} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </Group>
        <Group gap={8} align="center">
          <AppTextInput
            flex={1}
            tone="body"
            mono
            readOnly
            value={tunnelCommand}
            aria-label={t('settings.line.webhook.commandLabel')}
          />
          <CopyIconButton value={tunnelCommand} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        </Group>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.line.webhook.step1Hint')}</Text>
        <Group gap={14}>
          <ExternalLink url={CLOUDFLARED_DOWNLOAD_URL} label={t('settings.line.webhook.installCloudflared')} />
          <ExternalLink url={CLOUDFLARE_TUNNEL_GUIDE_URL} label={t('settings.line.webhook.namedTunnel')} />
        </Group>
      </StepBox>

      <StepBox step={2} label={t('settings.line.webhook.step2')}>
        <Text fz="var(--font-size-sm)" ff="var(--font-mono)" c="var(--mantine-color-default-color)">
          {sampleWebhookUrl}
        </Text>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.line.webhook.step2Hint')}</Text>
        <Group gap={14}>
          <ExternalLink url={LINE_DEVELOPERS_CONSOLE_URL} label={t('settings.line.account.openConsole')} />
        </Group>
      </StepBox>
    </Stack>
  );
};
