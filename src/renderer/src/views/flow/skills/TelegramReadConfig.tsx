import React, { useEffect, useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { StatusLine } from '../../../components/StatusLine';
import { telegramApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { useChatNameStore } from '../../../store/chatNameStore';
import { useSeenOnScreen } from '../../../hooks/useSeenOnScreen';
import { distinctChatLabels, savedChatOptions } from '../../../utils/savedChatOptions';
import { DEFAULT_TELEGRAM_READ_RANGE, TELEGRAM_READ_RANGES } from '../../../../../shared/telegramReadRange';
import type { TelegramSettingsSnapshot } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

function splitIds(value: string): string[] {
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

const isGroupType = (type: string | undefined): boolean => type === 'group' || type === 'supergroup';

/** The bot's groups by name: the ones it found it can post in, then any other it has met. */
function groupsOf(snapshot: TelegramSettingsSnapshot): Array<{ id: string; name: string }> {
  const out = new Map<string, string>();
  for (const channel of snapshot.channels) {
    if (isGroupType(channel.chatType)) out.set(String(channel.chatId), channel.title || '');
  }
  for (const contact of snapshot.contacts) {
    if (contact.kind === 'chat' && isGroupType(contact.chatType) && !out.has(contact.id)) out.set(contact.id, contact.title || '');
  }
  return [...out].map(([id, name]) => ({ id, name }));
}

interface GroupList {
  groups: Array<{ id: string; name: string }>;
  /** A bot token is saved and Telegram is on: the only setup the stored messages need. */
  configured: boolean;
}

/**
 * The `telegram_read` step: which groups, which window. Selecting no group reads every group the
 * bot kept messages from. What the field holds is always a named pill (a group not in the list,
 * from another computer, is "not in the list N"; a flow setting is its name), and a Telegram that
 * is not set up says so with the way to set it up.
 */
export const TelegramReadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowVariables }) => {
  const currentView = useAppStore((s) => s.currentView);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const names = useChatNameStore((s) => s.names);
  const remember = useChatNameStore((s) => s.remember);
  const [boxRef, onScreen] = useSeenOnScreen();
  const [list, setList] = useState<GroupList | null>(null);

  useEffect(() => {
    if (currentView !== 'flow' || !onScreen) return undefined;
    let alive = true;
    void telegramApi.getSettings().then((snapshot) => {
      if (!alive) return;
      const groups = groupsOf(snapshot);
      remember(groups);
      setList({ groups, configured: snapshot.enabled && snapshot.hasToken });
    });
    return () => { alive = false; };
  }, [currentView, onScreen, remember]);

  const selected = useMemo(() => splitIds(step.config.chat ?? ''), [step.config.chat]);
  const options = useMemo(() => {
    const groups = list?.groups ?? [];
    const named = groups.filter((group) => group.name);
    const labels = distinctChatLabels(named, t);
    const offered = named.map((group) => ({ value: group.id, label: labels.get(group.id) ?? group.name }));
    const saved = savedChatOptions(selected, new Set(offered.map((option) => option.value)), {
      t,
      variables: flowVariables,
      names,
      loading: list === null,
      settingsGroup: t('flow.chatPicker.group.setting'),
      missingGroup: t('flow.chatPicker.group.unlisted'),
    });
    return [...offered, ...saved];
  }, [list, selected, t, flowVariables, names]);

  return (
    <Stack gap="xs" ref={boxRef}>
      <Stack gap={4}>
        <MultiSelectDropdown
          label={t('flow.skill.telegram_read.chat')}
          options={options}
          value={selected}
          onChange={(next) => onChange({ ...step.config, chat: next.join(',') })}
          searchable
          clearable
          placeholder={t('flow.skill.telegram_read.chat.placeholder')}
          size="sm"
        />
        {list?.configured === false ? (
          <Group gap="xs" align="center" wrap="nowrap" data-telegram-unset="">
            <StatusLine tone="warning">{t('flow.skill.telegram_read.notSetUp')}</StatusLine>
            <AppButton
              variant="light"
              size="compact-xs"
              leftSection={<Settings size={12} />}
              onClick={() => openSettingsCategory('bots')}
              style={{ flexShrink: 0 }}
            >
              {t('flow.setup.openSettings')}
            </AppButton>
          </Group>
        ) : (
          <Text fz="xs" c="var(--text-muted)">{t('flow.skill.telegram_read.chat.hint')}</Text>
        )}
      </Stack>

      <SelectDropdown
        label={t('flow.skill.telegram_read.range')}
        options={TELEGRAM_READ_RANGES.map((range) => ({ value: range, label: t(`flow.skill.telegram_read.range.${range}`) }))}
        value={step.config.range || DEFAULT_TELEGRAM_READ_RANGE}
        onChange={(next) => onChange({ ...step.config, range: next })}
        size="sm"
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.telegram_read.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
