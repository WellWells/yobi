import React, { useEffect, useMemo, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { lineApi, socketBotApi, telegramApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { lineAccountLabel, telegramAccountChoiceLabel } from '../utils/botAccountLabel';
import { BOT_PLATFORM_NAMES, SOCKET_BOT_PLATFORMS } from '../../../shared/types';
import type { BotPlatform, LinePairedUser, TelegramPairedUser } from '../../../shared/types';

type StringIdPlatform = Exclude<BotPlatform, 'telegram'>;
const STRING_ID_PLATFORMS: readonly StringIdPlatform[] = ['line', ...SOCKET_BOT_PLATFORMS];

interface Choice {
  value: string;
  label: string;
}

export interface BotUserAllowlistProps {
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}

/**
 * Which paired users may run one flow's bot command, shown only when the command is limited to
 * selected people (`botAccess: 'users'`), where an empty list is nobody.
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
  /** Paired people on the platforms with string ids, in `STRING_ID_PLATFORMS` order. */
  const [stringIdUsers, setStringIdUsers] = useState<Partial<Record<StringIdPlatform, LinePairedUser[]>>>({});

  useEffect(() => {
    if (currentView !== 'flow') return;
    void telegramApi.getSettings().then((s) => setTelegramUsers(s.pairing.pairedUsers));
    void lineApi.getSettings().then((s) => setStringIdUsers((prev) => ({ ...prev, line: s.pairing.pairedUsers })));
    for (const platform of SOCKET_BOT_PLATFORMS) {
      void socketBotApi.getSettings(platform).then((s) => {
        if (s) setStringIdUsers((prev) => ({ ...prev, [platform]: s.pairing.pairedUsers }));
      });
    }
  }, [currentView]);

  const selected = useMemo(() => value ?? [], [value]);

  const groups = useMemo(() => {
    const telegram: Choice[] = telegramUsers.map((user) => ({
      value: String(user.userId),
      label: telegramAccountChoiceLabel(user, t),
    }));
    const others = STRING_ID_PLATFORMS.map((platform) => ({
      platform,
      items: (stringIdUsers[platform] ?? []).map((user) => ({ value: user.userId, label: lineAccountLabel(user, t) })),
    }));
    return [{ platform: 'telegram' as const, items: telegram }, ...others];
  }, [telegramUsers, stringIdUsers, t]);

  const options = useMemo(() => {
    const known = new Set(groups.flatMap((group) => group.items.map((choice) => choice.value)));
    const orphans: Choice[] = selected
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: id }));

    return [
      ...groups.filter((group) => group.items.length > 0).map((group) => ({ group: BOT_PLATFORM_NAMES[group.platform], items: group.items })),
      ...(orphans.length > 0 ? [{ group: t('flow.trigger.bot.allowedUsers.unpaired'), items: orphans }] : []),
    ];
  }, [groups, selected, t]);

  const hasAnyone = groups.some((group) => group.items.length > 0) || selected.length > 0;

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
