import React, { useEffect, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { Search, Timer, Waypoints } from 'lucide-react';
import {
  AGENT_ASK_TTL_MAX_MINUTES,
  AGENT_ASK_TTL_MIN_MINUTES,
  BOT_BUILTIN_COMMAND_KEYS,
  BOT_COMMAND_RE,
  DEFAULT_BUILTIN_COMMANDS,
  isModelUrlHidden,
} from '../../../../../shared/types';
import type {
  BotBuiltinCommand,
  BotBuiltinCommandKey,
  BotBuiltinCommands as BuiltinCommandsConfig,
} from '../../../../../shared/types';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SelectDropdown, SettingRow, ToggleSwitch } from '../components';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import { selectHiddenSources, useAppStore } from '../../../store/appStore';

const BUILTIN_ICONS: Record<BotBuiltinCommandKey, React.FC<{ size?: number }>> = {
  agent: Waypoints,
  search: Search,
};

interface Props {
  builtinCommands: BuiltinCommandsConfig;
  busy: boolean;
  onUpdate: (key: BotBuiltinCommandKey, patch: Partial<BotBuiltinCommand>) => void;
  onUpdateAskTtl: (minutes: number) => void;
  t: (key: string) => string;
}

interface RowProps {
  commandKey: BotBuiltinCommandKey;
  cfg: BotBuiltinCommand;
  busy: boolean;
  onUpdate: (key: BotBuiltinCommandKey, patch: Partial<BotBuiltinCommand>) => void;
  t: (key: string) => string;
}

const BuiltinCommandRow: React.FC<RowProps> = ({ commandKey, cfg, busy, onUpdate, t }) => {
  const def = DEFAULT_BUILTIN_COMMANDS[commandKey];
  const [name, setName] = useState(cfg.command);
  useEffect(() => { setName(cfg.command); }, [cfg.command]);

  const hidden = useAppStore(useShallow(selectHiddenSources));
  const targetHidden = cfg.targetUrl !== '' && isModelUrlHidden(cfg.targetUrl, hidden);
  const { sections, allModels } = useProviderModels(targetHidden ? '' : cfg.targetUrl);
  const options = [
    { value: '', label: t('settings.bot.builtin.modelAppDefault') },
    ...providerSectionsToSelectData(sections),
  ];
  const known = !targetHidden
    && (cfg.targetUrl === '' || allModels.some((model) => model.url === cfg.targetUrl));

  const trimmed = name.trim().toLowerCase();
  const invalid = trimmed !== '' && !BOT_COMMAND_RE.test(trimmed);

  const commit = (): void => {
    if (invalid || trimmed === cfg.command) return;
    onUpdate(commandKey, { command: trimmed });
  };

  const Icon = BUILTIN_ICONS[commandKey];

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="center" gap={8} wrap="nowrap">
        <Group gap={8} align="center" style={{ minWidth: 0 }}>
          <Icon size={14} />
          <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)">
            {t(`settings.bot.builtin.${commandKey}.label`)}
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
            onChange={(e) => onUpdate(commandKey, { enabled: e.currentTarget.checked })}
          />
        </Group>
      </Group>

      {cfg.enabled && (
        <Box pl={22} style={{ borderLeft: '2px solid var(--mantine-color-default-border)' }} ml={6}>
          <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" mb={4}>
            {t('settings.bot.builtin.modelLabel')}
          </Text>
          <SelectDropdown
            value={known ? cfg.targetUrl : ''}
            options={options}
            onChange={(v) => onUpdate(commandKey, { targetUrl: v })}
            disabled={busy}
            maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
          />
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mt={4}>
            {t(`settings.bot.builtin.${commandKey}.hint`)}
          </Text>
        </Box>
      )}
    </Stack>
  );
};

export const BotBuiltinCommands: React.FC<Props> = ({
  builtinCommands, busy, onUpdate, onUpdateAskTtl, t,
}) => {
  const [ttl, setTtl] = useState(String(builtinCommands.askTtlMinutes));
  useEffect(() => { setTtl(String(builtinCommands.askTtlMinutes)); }, [builtinCommands.askTtlMinutes]);

  const commitTtl = (): void => {
    const parsed = Number(ttl);
    if (!Number.isFinite(parsed)) {
      setTtl(String(builtinCommands.askTtlMinutes));
      return;
    }
    const clamped = Math.min(AGENT_ASK_TTL_MAX_MINUTES, Math.max(AGENT_ASK_TTL_MIN_MINUTES, Math.round(parsed)));
    setTtl(String(clamped));
    onUpdateAskTtl(clamped);
  };

  return (
    <Box>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={10}>
        {t('settings.bot.builtin.hint')}
      </Text>
      <Stack gap={12}>
        {BOT_BUILTIN_COMMAND_KEYS.map((key) => (
          <BuiltinCommandRow
            key={key}
            commandKey={key}
            cfg={builtinCommands[key]}
            busy={busy}
            onUpdate={onUpdate}
            t={t}
          />
        ))}
        {builtinCommands.agent.enabled && (
          <SettingRow
            icon={<Timer size={13} />}
            label={t('settings.bot.builtin.askTtl.label')}
            hint={t('settings.bot.builtin.askTtl.hint')}
            alignStart
            control={
              <AppNumberInput
                w={110}
                min={AGENT_ASK_TTL_MIN_MINUTES}
                max={AGENT_ASK_TTL_MAX_MINUTES}
                value={ttl}
                onChange={(value) => setTtl(String(value))}
                onBlur={commitTtl}
                disabled={busy}
              />
            }
          />
        )}
      </Stack>
    </Box>
  );
};
