import React, { useEffect, useMemo, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { telegramApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { DEFAULT_TELEGRAM_READ_RANGE, TELEGRAM_READ_RANGES } from '../../../../../shared/telegramReadRange';
import type { TelegramSettingsSnapshot } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

function splitIds(value: string): string[] {
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

const isGroupType = (type: string | undefined): boolean => type === 'group' || type === 'supergroup';

/** The bot's groups by name: the ones it found it can post in, then any other it has met. */
function groupsOf(snapshot: TelegramSettingsSnapshot): Array<{ value: string; label: string }> {
  const out = new Map<string, string>();
  for (const channel of snapshot.channels) {
    if (isGroupType(channel.chatType)) out.set(String(channel.chatId), channel.title || String(channel.chatId));
  }
  for (const contact of snapshot.contacts) {
    if (contact.kind === 'chat' && isGroupType(contact.chatType) && !out.has(contact.id)) out.set(contact.id, contact.title || contact.id);
  }
  return [...out].map(([value, label]) => ({ value, label }));
}

/**
 * The `telegram_read` step: which groups, which window. Selecting no group reads every group the
 * bot kept messages from; an id missing from the list (a flow from another machine) stays as itself.
 */
export const TelegramReadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const currentView = useAppStore((s) => s.currentView);
  const [groups, setGroups] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    if (currentView !== 'flow') return;
    void telegramApi.getSettings().then((snapshot) => setGroups(groupsOf(snapshot)));
  }, [currentView]);

  const selected = useMemo(() => splitIds(step.config.chat ?? ''), [step.config.chat]);
  const options = useMemo(() => {
    const known = new Set(groups.map((group) => group.value));
    return [...groups, ...selected.filter((id) => !known.has(id)).map((id) => ({ value: id, label: id }))];
  }, [groups, selected]);

  return (
    <Stack gap="xs">
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
        <Text fz="xs" c="dimmed">{t('flow.skill.telegram_read.chat.hint')}</Text>
      </Stack>

      <SelectDropdown
        label={t('flow.skill.telegram_read.range')}
        options={TELEGRAM_READ_RANGES.map((range) => ({ value: range, label: t(`flow.skill.telegram_read.range.${range}`) }))}
        value={step.config.range || DEFAULT_TELEGRAM_READ_RANGE}
        onChange={(next) => onChange({ ...step.config, range: next })}
        size="sm"
      />

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.telegram_read.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
