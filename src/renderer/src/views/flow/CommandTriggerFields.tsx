import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Bot, MessageSquare, TriangleAlert } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { GroupHeader } from '../../components/GroupHeader';
import type { TriggerConfig } from '../../../../shared/types';
import type { FlowIssue } from '../../../../shared/flowIssues';
import { describeFlowIssue } from './flowIssueText';
import { BotCommandAccessField } from './BotCommandAccessField';

interface CommandTriggerFieldsProps {
  kind: 'bot' | 'chat';
  value: TriggerConfig;
  patch: (p: Partial<TriggerConfig>) => void;
  t: (k: string) => string;
  /** Another enabled flow already claims this command. */
  conflict?: FlowIssue;
  showBotCompoundHint?: boolean;
  cardStyle?: React.CSSProperties;
  /** The flow reads the owner's own data (decides how a bot command without a mode reads). */
  ownerData?: boolean;
}

const FIELDS = {
  bot: { command: 'botCommand', description: 'botCommandDescription', inputVariable: 'botInputVariable' },
  chat: { command: 'chatCommand', description: 'chatCommandDescription', inputVariable: 'chatInputVariable' },
} as const;

export const CommandTriggerFields: React.FC<CommandTriggerFieldsProps> = ({
  kind, value, patch, t, conflict, showBotCompoundHint = false, cardStyle, ownerData = false,
}) => {
  const fields = FIELDS[kind];
  const Icon = kind === 'bot' ? Bot : MessageSquare;
  const tk = (suffix: string): string => t(`flow.trigger.${kind}.${suffix}`);

  const commandValue = value[fields.command] ?? '';
  const descriptionValue = value[fields.description] ?? '';
  const inputVariableValue = value[fields.inputVariable] ?? '';

  const commandEmpty = !commandValue.trim();
  const inputVariableName = inputVariableValue.trim() || tk('inputVariable.placeholder');
  const inputVariableHint = tk('inputVariable.hint').replace(/\{\{(input|variable)\}\}/g, inputVariableName);

  return (
    <Stack gap="sm" p="sm" style={cardStyle}>
      <GroupHeader variant="plain" icon={<Icon size={13} />} label={tk('section')} />

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

      {kind === 'bot' && <BotCommandAccessField value={value} patch={patch} t={t} ownerData={ownerData} />}

      {commandEmpty && (
        <Group gap={6} align="center">
          <TriangleAlert size={13} color="var(--mantine-color-warning)" />
          <Text fz="xs" c="var(--mantine-color-warning)">{tk('command.empty')}</Text>
        </Group>
      )}

      {conflict && (
        <Group gap={6} align="flex-start" wrap="nowrap">
          <TriangleAlert size={13} color="var(--mantine-color-warning)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Text fz="xs" c="var(--mantine-color-warning)">{describeFlowIssue(conflict, t)}</Text>
        </Group>
      )}

      {kind === 'bot' && showBotCompoundHint && (
        <Group gap={6} align="flex-start" wrap="nowrap">
          <TriangleAlert size={13} color="var(--mantine-color-dimmed)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Text fz="xs" c="dimmed">{t('flow.trigger.bot.scheduleHint')}</Text>
        </Group>
      )}
    </Stack>
  );
};
