import React from 'react';
import { Group, Input, Stack, Text } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';
import { BotUserAllowlist } from '../../components/BotUserAllowlist';
import { botCommandAccessMode, isBotCommandAccessMode } from '../../../../shared/botCommandAccess';
import type { TriggerConfig } from '../../../../shared/types';
import { isTriggerClosed } from '../../../../shared/flowIssues';

interface BotCommandAccessFieldProps {
  value: TriggerConfig;
  patch: (p: Partial<TriggerConfig>) => void;
  t: (k: string) => string;
}

/**
 * Who may run a flow's bot command. Every change writes the mode explicitly: a trigger saved
 * before the mode existed reads an empty list as everyone, so clearing a restricted command's
 * list without it would open the command up instead of closing it. The list stays on the trigger
 * under "everyone" (that mode ignores it), so switching back does not lose the selection.
 */
export const BotCommandAccessField: React.FC<BotCommandAccessFieldProps> = ({ value, patch, t }) => {
  const mode = botCommandAccessMode(value.botAccess, value.botAllowedUserIds);

  const setMode = (next: string): void => {
    if (!isBotCommandAccessMode(next) || next === mode) return;
    patch({ botAccess: next });
  };

  return (
    <Stack gap={6}>
      <Input.Wrapper label={t('flow.trigger.bot.access')}>
        <AppSegmentedControl
          value={mode}
          options={[
            { value: 'all', label: t('flow.trigger.bot.access.all') },
            { value: 'users', label: t('flow.trigger.bot.access.users') },
          ]}
          onChange={setMode}
          size="sm"
        />
      </Input.Wrapper>
      {mode === 'all' && <Text fz="xs" c="dimmed">{t('flow.trigger.bot.access.all.hint')}</Text>}
      {mode === 'users' && (
        <BotUserAllowlist
          value={value.botAllowedUserIds}
          onChange={(botAllowedUserIds) => patch({ botAccess: 'users', botAllowedUserIds })}
        />
      )}
      {isTriggerClosed(value) && (
        <Group gap={6} align="center">
          <TriangleAlert size={13} color="var(--mantine-color-error)" />
          <Text fz="xs" c="var(--mantine-color-error)">{t('flow.trigger.bot.access.nobody')}</Text>
        </Group>
      )}
    </Stack>
  );
};
