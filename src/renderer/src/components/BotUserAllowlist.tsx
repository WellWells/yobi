import React, { useEffect, useMemo, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { lineApi, telegramApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import type { LinePairedUser, TelegramPairedUser } from '../../../shared/types';

interface Choice {
  value: string;
  label: string;
}

function telegramLabel(user: TelegramPairedUser): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  if (fullName) return user.username ? `${fullName} (@${user.username})` : fullName;
  return user.username ? `@${user.username}` : String(user.userId);
}

export interface BotUserAllowlistProps {
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}

/**
 * Which paired users may run one flow's bot command. Empty means all of them, which is the rule
 * every flow written before this field was added still runs under.
 *
 * Both platforms are listed together because a command is registered on whichever bots are
 * running, not on one of them. An id already on the list that no longer belongs to a paired user
 * is kept as an option of its own: dropping it would silently widen the command's access the
 * first time its author opened the editor.
 */
export const BotUserAllowlist: React.FC<BotUserAllowlistProps> = ({ value, onChange }) => {
  const t = useI18nStore((s) => s.t);
  const currentView = useAppStore((s) => s.currentView);
  const [telegramUsers, setTelegramUsers] = useState<TelegramPairedUser[]>([]);
  const [lineUsers, setLineUsers] = useState<LinePairedUser[]>([]);

  useEffect(() => {
    if (currentView !== 'flow') return;
    void telegramApi.getSettings().then((s) => setTelegramUsers(s.pairing.pairedUsers));
    void lineApi.getSettings().then((s) => setLineUsers(s.pairing.pairedUsers));
  }, [currentView]);

  const selected = useMemo(() => value ?? [], [value]);

  const options = useMemo(() => {
    const telegram: Choice[] = telegramUsers.map((user) => ({
      value: String(user.userId),
      label: telegramLabel(user),
    }));
    const line: Choice[] = lineUsers.map((user) => ({
      value: user.userId,
      label: user.displayName || user.userId,
    }));
    const known = new Set([...telegram, ...line].map((choice) => choice.value));
    const orphans: Choice[] = selected
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: id }));

    return [
      ...(telegram.length > 0 ? [{ group: t('flow.skill.bot.platform.telegram'), items: telegram }] : []),
      ...(line.length > 0 ? [{ group: t('flow.skill.bot.platform.line'), items: line }] : []),
      ...(orphans.length > 0 ? [{ group: t('flow.trigger.bot.allowedUsers.unpaired'), items: orphans }] : []),
    ];
  }, [telegramUsers, lineUsers, selected, t]);

  const hasAnyone = telegramUsers.length > 0 || lineUsers.length > 0 || selected.length > 0;

  return (
    <Stack gap={4}>
      <MultiSelectDropdown
        label={t('flow.trigger.bot.allowedUsers')}
        placeholder={t('flow.trigger.bot.allowedUsers.placeholder')}
        options={options}
        value={selected}
        onChange={onChange}
        disabled={!hasAnyone}
        searchable
        clearable
        size="sm"
      />
      <Text fz="xs" c="dimmed">
        {t(hasAnyone ? 'flow.trigger.bot.allowedUsers.hint' : 'flow.trigger.bot.allowedUsers.noPaired')}
      </Text>
    </Stack>
  );
};
