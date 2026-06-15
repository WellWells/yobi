import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Bot, MessageSquare, TriangleAlert } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import type { TriggerConfig } from '../../../../shared/types';

interface CommandTriggerFieldsProps {
  kind: 'bot' | 'chat';
  value: TriggerConfig;
  patch: (p: Partial<TriggerConfig>) => void;
  t: (k: string) => string;
  showBotCompoundHint?: boolean;
  cardStyle?: React.CSSProperties;
}

const FIELDS = {
  bot: { command: 'botCommand', description: 'botCommandDescription', inputVariable: 'botInputVariable' },
  chat: { command: 'chatCommand', description: 'chatCommandDescription', inputVariable: 'chatInputVariable' },
} as const;

export const CommandTriggerFields: React.FC<CommandTriggerFieldsProps> = ({
  kind, value, patch, t, showBotCompoundHint = false, cardStyle,
}) => {
  const fields = FIELDS[kind];
  const Icon = kind === 'bot' ? Bot : MessageSquare;
  const tk = (suffix: string): string => t(`agentflow.trigger.${kind}.${suffix}`);

  const commandValue = value[fields.command] ?? '';
  const descriptionValue = value[fields.description] ?? '';
  const inputVariableValue = value[fields.inputVariable] ?? '';

  const commandEmpty = !commandValue.trim();
  const inputVariableName = inputVariableValue.trim() || tk('inputVariable.placeholder');
  const inputVariableHint = tk('inputVariable.hint').replace(/\{\{(input|variable)\}\}/g, inputVariableName);

  return (
    <Stack gap="sm" p="sm" style={cardStyle}>
      <Group gap={6} align="center">
        <Icon size={13} color="var(--mantine-color-dimmed)" />
        <Text fz="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
          {tk('section')}
        </Text>
      </Group>

      <AppTextInput
        label={tk('command')}
        description={tk('command.hint')}
        placeholder={tk('command.placeholder')}
        value={commandValue}
        onChange={(e) => patch({ [fields.command]: e.currentTarget.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() } as Partial<TriggerConfig>)}
        leftSection={<Text fz="sm" c="dimmed">/</Text>}
        mono
        tone="body"
        size="sm"
      />

      <AppTextInput
        label={t('common.description')}
        placeholder={tk('description.placeholder')}
        value={descriptionValue}
        onChange={(e) => patch({ [fields.description]: e.currentTarget.value } as Partial<TriggerConfig>)}
        tone="body"
        size="sm"
      />

      <AppTextInput
        label={tk('inputVariable')}
        description={inputVariableHint}
        placeholder={tk('inputVariable.placeholder')}
        value={inputVariableValue}
        onChange={(e) => patch({ [fields.inputVariable]: e.currentTarget.value.replace(/[^a-zA-Z0-9_.]/g, '') } as Partial<TriggerConfig>)}
        mono
        tone="body"
        size="sm"
      />

      {commandEmpty && (
        <Group gap={6} align="center">
          <TriangleAlert size={13} color="var(--mantine-color-orange-6)" />
          <Text fz="xs" c="orange">{tk('command.empty')}</Text>
        </Group>
      )}

      {kind === 'bot' && showBotCompoundHint && (
        <Group gap={6} align="flex-start" wrap="nowrap">
          <TriangleAlert size={13} color="var(--mantine-color-dimmed)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Text fz="xs" c="dimmed">{t('agentflow.trigger.bot.scheduleHint')}</Text>
        </Group>
      )}
    </Stack>
  );
};
