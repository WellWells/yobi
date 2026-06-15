import React, { useEffect, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import {
  DEFAULT_PROVIDER_COMMANDS,
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_URLS,
  TELEGRAM_COMMAND_RE,
} from '../../../../../shared/types';
import type { DuckaiModelInfo, Provider, TelegramProviderCommand } from '../../../../../shared/types';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown, ToggleSwitch } from '../components';
import { getModelIconByUrl } from '../../../config/models';

const DUCK_DEFAULT = '__default';

interface Props {
  providerCommands: Record<Provider, TelegramProviderCommand>;
  duckaiModels: DuckaiModelInfo[];
  busy: boolean;
  onUpdate: (provider: Provider, patch: Partial<TelegramProviderCommand>) => void;
  t: (key: string) => string;
}

interface RowProps {
  provider: Provider;
  cfg: TelegramProviderCommand;
  duckaiModels: DuckaiModelInfo[];
  busy: boolean;
  onUpdate: (provider: Provider, patch: Partial<TelegramProviderCommand>) => void;
  t: (key: string) => string;
}

const ProviderCommandRow: React.FC<RowProps> = ({ provider, cfg, duckaiModels, busy, onUpdate, t }) => {
  const def = DEFAULT_PROVIDER_COMMANDS[provider];
  const [name, setName] = useState(cfg.command);
  useEffect(() => { setName(cfg.command); }, [cfg.command]);

  const trimmed = name.trim().toLowerCase();
  const invalid = trimmed !== '' && !TELEGRAM_COMMAND_RE.test(trimmed);

  const commit = () => {
    if (invalid || trimmed === cfg.command) return;
    onUpdate(provider, { command: trimmed });
  };

  const Icon = getModelIconByUrl(PROVIDER_URLS[provider]);

  const modelOptions = [
    { value: DUCK_DEFAULT, label: t('settings.telegram.commands.modelDefault') },
    ...duckaiModels.map((m) => ({ value: m.id, label: m.label })),
  ];
  if (cfg.modelId && !duckaiModels.some((m) => m.id === cfg.modelId)) {
    modelOptions.push({ value: cfg.modelId, label: cfg.modelId });
  }

  return (
    <Stack gap={6}>
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
            error={invalid ? t('settings.telegram.commands.invalid') : undefined}
          />
          <ToggleSwitch
            checked={cfg.enabled}
            disabled={busy}
            onChange={(e) => onUpdate(provider, { enabled: e.currentTarget.checked })}
          />
        </Group>
      </Group>

      {provider === 'duckai' && cfg.enabled && (
        <Box pl={22} style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }} ml={6}>
          <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" mb={4}>
            {t('settings.telegram.commands.modelLabel')}
          </Text>
          <SelectDropdown
            value={cfg.modelId ? cfg.modelId : DUCK_DEFAULT}
            options={modelOptions}
            onChange={(v) => onUpdate('duckai', { modelId: v === DUCK_DEFAULT ? '' : v })}
            disabled={busy}
          />
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mt={4}>
            {t('settings.telegram.commands.modelHint')}
          </Text>
        </Box>
      )}
    </Stack>
  );
};

export const TelegramProviderCommands: React.FC<Props> = ({
  providerCommands, duckaiModels, busy, onUpdate, t,
}) => (
  <Box>
    <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={10}>
      {t('settings.telegram.commands.hint')}
    </Text>
    <Stack gap={12}>
      {PROVIDERS.map((provider) => (
        <ProviderCommandRow
          key={provider}
          provider={provider}
          cfg={providerCommands[provider]}
          duckaiModels={duckaiModels}
          busy={busy}
          onUpdate={onUpdate}
          t={t}
        />
      ))}
    </Stack>
  </Box>
);
