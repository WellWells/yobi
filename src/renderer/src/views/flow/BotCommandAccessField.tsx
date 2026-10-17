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
  /** The flow reads the owner's own data: a trigger without a mode runs as admins-only. */
  ownerData?: boolean;
}

/**
 * Who may run a flow's bot command. Every change writes the mode explicitly: a trigger without a
 * mode reads an empty list as everyone (the admins over the owner's own data),
 * so clearing a restricted command's list without it would open the command up instead of
 * closing it. The list stays on the trigger under the other modes (they ignore it), so switching
 * back does not lose the selection.
 */
export const BotCommandAccessField: React.FC<BotCommandAccessFieldProps> = ({ value, patch, t, ownerData = false }) => {
  const mode = botCommandAccessMode(value.botAccess, value.botAllowedUserIds, ownerData);

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
            { value: 'admins', label: t('flow.trigger.bot.access.admins') },
            { value: 'users', label: t('flow.trigger.bot.access.users') },
          ]}
          onChange={setMode}
          size="sm"
        />
      </Input.Wrapper>
      {mode === 'all' && <Text fz="xs" c="dimmed">{t('flow.trigger.bot.access.all.hint')}</Text>}
      {mode === 'admins' && <Text fz="xs" c="dimmed">{t('flow.trigger.bot.access.admins.hint')}</Text>}
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
