import React, { useEffect, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { KeyRound, Layers } from 'lucide-react';
import {
  BOT_COMMAND_RE,
  DEFAULT_PROVIDER_COMMANDS,
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_URLS,
} from '../../../../../shared/types';
import type {
  BotByokCommandInfo,
  BotProviderCommand,
  Provider,
} from '../../../../../shared/types';
import { AppTextInput } from '../../../components/AppTextInput';
import { SettingDivider, ToggleSwitch } from '../components';
import { getModelIconByUrl } from '../../../config/models';

interface Props {
  providerCommands: Record<Provider, BotProviderCommand>;
  byokCommands: BotByokCommandInfo[];
  busy: boolean;
  onUpdate: (provider: Provider, patch: Partial<BotProviderCommand>) => void;
  onToggleByok: (id: string, enabled: boolean) => void;
  t: (key: string) => string;
}

interface RowProps {
  provider: Provider;
  cfg: BotProviderCommand;
  busy: boolean;
  onUpdate: (provider: Provider, patch: Partial<BotProviderCommand>) => void;
  t: (key: string) => string;
}

const ProviderCommandRow: React.FC<RowProps> = ({ provider, cfg, busy, onUpdate, t }) => {
  const def = DEFAULT_PROVIDER_COMMANDS[provider];
  const [name, setName] = useState(cfg.command);
  useEffect(() => { setName(cfg.command); }, [cfg.command]);

  const trimmed = name.trim().toLowerCase();
  const invalid = trimmed !== '' && !BOT_COMMAND_RE.test(trimmed);

  const commit = () => {
    if (invalid || trimmed === cfg.command) return;
    onUpdate(provider, { command: trimmed });
  };

  const Icon = getModelIconByUrl(PROVIDER_URLS[provider]);

  return (
    <Group justify="space-between" align="center" gap={8} wrap="nowrap">
      <Group gap={8} align="center" style={{ minWidth: 0 }}>
        <Icon size={14} />
        <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)">
          {PROVIDER_LABELS[provider]}
        </Text>
      </Group>
      <Group gap={8} align="center" wrap="nowrap">
        <Text fz="var(--font-size-base)" c="dimmed">/</Text>
        <AppTextInput
          tone="body"
          mono
          w={150}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={commit}
          placeholder={def}
          disabled={busy || !cfg.enabled}
          error={invalid ? t('settings.bot.commands.invalid') : undefined}
        />
        <ToggleSwitch
          checked={cfg.enabled}
          disabled={busy}
          onChange={(e) => onUpdate(provider, { enabled: e.currentTarget.checked })}
        />
      </Group>
    </Group>
  );
};

const ByokCommandRow: React.FC<{
  info: BotByokCommandInfo;
  busy: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  t: (key: string) => string;
}> = ({ info, busy, onToggle, t }) => {
  const Icon = info.kind === 'group' ? Layers : KeyRound;
  return (
    <Group justify="space-between" align="center" gap={8} wrap="nowrap">
      <Group gap={8} align="center" style={{ minWidth: 0 }}>
        <Icon size={14} />
        <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" truncate>
          {info.name}
        </Text>
      </Group>
      <Group gap={8} align="center" wrap="nowrap">
        {info.hidden ? (
          <Text fz="var(--font-size-sm)" c="dimmed" w={162} ta="right">
            {t('settings.modelSources.hidden')}
          </Text>
        ) : info.command ? (
          <Text fz="var(--font-size-base)" c="dimmed" ff="monospace" w={162} ta="right">
            /{info.command}
          </Text>
        ) : (
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" w={162} ta="right">
            {t('settings.bot.commands.byok.unavailable')}
          </Text>
        )}
        <ToggleSwitch
          checked={info.enabled}
          disabled={busy}
          onChange={(e) => onToggle(info.id, e.currentTarget.checked)}
        />
      </Group>
    </Group>
  );
};

export const BotProviderCommands: React.FC<Props> = ({
  providerCommands, byokCommands, busy, onUpdate, onToggleByok, t,
}) => (
  <Box>
    <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={10}>
      {t('settings.bot.commands.hint')}
    </Text>
    <Stack gap={12}>
      {PROVIDERS.map((provider) => (
        <ProviderCommandRow
          key={provider}
          provider={provider}
          cfg={providerCommands[provider]}
          busy={busy}
          onUpdate={onUpdate}
          t={t}
        />
      ))}
    </Stack>

    {byokCommands.length > 0 && (
      <Box>
        <SettingDivider my={14} />
        <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">
          {t('settings.bot.commands.byok.title')}
        </Text>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={10}>
          {t('settings.bot.commands.byok.hint')}
        </Text>
        <Stack gap={12}>
          {byokCommands.map((info) => (
            <ByokCommandRow
              key={`${info.kind}:${info.id}`}
              info={info}
              busy={busy}
              onToggle={onToggleByok}
              t={t}
            />
          ))}
        </Stack>
      </Box>
    )}
  </Box>
);
