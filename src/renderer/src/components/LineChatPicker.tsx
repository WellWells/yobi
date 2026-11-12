import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { RefreshCw, Settings } from 'lucide-react';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { AppButton } from './AppButton';
import { lineApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { useChatNameStore } from '../store/chatNameStore';
import { useSeenOnScreen } from '../hooks/useSeenOnScreen';
import { distinctChatLabels, savedChatOptions } from '../utils/savedChatOptions';
import type { FlowVariable, LineChatListResult } from '../../../shared/types';

export interface LineChatPickerProps {
  /** Comma-separated chat ids, exactly as the step config stores them. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  /** The flow's settings, so a `{{var.x}}` in the field shows the setting's name. */
  variables?: readonly FlowVariable[];
}

/**
 * Friends first, official accounts last: multi-select plus a per-chat limit makes it very easy
 * to flood a prompt with marketing broadcasts, so they are the hardest group to reach for.
 */
const GROUP_ORDER = ['personal', 'group', 'multi', 'open', 'official', 'unknown'] as const;

function splitIds(value: string): string[] {
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

/**
 * Picks the LINE conversations a line_read step reads. The list comes from the LINE app on this
 * computer, grouped by kind with the bare chat name as the label (the group heading already names
 * the kind); two chats with the same name say their kind or a number.
 *
 * Selecting nothing means every chat, read as one combined search. There is no "all chats" entry:
 * a sentinel in a multi-select would have to clear the other rows to mean anything.
 *
 * What the field holds is always a named pill and always removable, also while the list is read
 * (the first read takes about a minute) or when it cannot be: see `savedChatOptions`. The list is
 * read once the picker is on screen, so a long flow with every card open does not read it per card.
 */
export const LineChatPicker: React.FC<LineChatPickerProps> = ({ value, onChange, label, hint, variables }) => {
  const t = useI18nStore((s) => s.t);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const currentView = useAppStore((s) => s.currentView);
  const names = useChatNameStore((s) => s.names);
  const remember = useChatNameStore((s) => s.remember);
  const [boxRef, onScreen] = useSeenOnScreen();
  const [result, setResult] = useState<LineChatListResult | null>(null);

  const load = useCallback(() => {
    setResult(null);
    void lineApi.listChats().then((next) => {
      setResult(next);
      if (next.ok) remember(next.chats);
    });
  }, [remember]);

  useEffect(() => {
    if (currentView !== 'flow' || !onScreen) return;
    load();
  }, [currentView, onScreen, load]);

  const selected = useMemo(() => splitIds(value), [value]);

  const options = useMemo(() => {
    const chats = result?.ok ? result.chats : [];
    const labels = distinctChatLabels(
      chats.map((chat) => ({ id: chat.id, name: chat.name, kind: chat.type })),
      t,
      (kind) => t(`flow.skill.line_read.chatGroup.${(GROUP_ORDER as readonly string[]).includes(kind) ? kind : 'unknown'}`),
    );
    const byGroup = new Map<string, { value: string; label: string }[]>();
    for (const chat of chats) {
      const key = (GROUP_ORDER as readonly string[]).includes(chat.type) ? chat.type : 'unknown';
      const bucket = byGroup.get(key) ?? [];
      bucket.push({ value: chat.id, label: labels.get(chat.id) ?? chat.name });
      byGroup.set(key, bucket);
    }
    const groups = GROUP_ORDER
      .filter((key) => byGroup.has(key))
      .map((key) => ({ group: t(`flow.skill.line_read.chatGroup.${key}`), items: byGroup.get(key) ?? [] }));

    const loading = result === null;
    const saved = savedChatOptions(selected, new Set(chats.map((chat) => chat.id)), {
      t,
      variables,
      names,
      loading,
      settingsGroup: t('flow.chatPicker.group.setting'),
      missingGroup: t(loading ? 'flow.skill.line_read.chat.loading' : 'flow.skill.line_read.chatGroup.unavailable'),
    });
    return [...groups, ...saved];
  }, [result, selected, t, variables, names]);

  const loading = result === null;
  const failed = result !== null && !result.ok;

  return (
    <Stack gap={4} ref={boxRef}>
      <MultiSelectDropdown
        label={label}
        options={options}
        value={selected}
        onChange={(next) => onChange(next.join(','))}
        searchable
        clearable
        nothingFoundMessage={t('flow.skill.line_read.chat.noMatch')}
        placeholder={loading ? t('flow.skill.line_read.chat.loading') : t('flow.skill.line_read.chat.placeholder')}
        size="sm"
      />
      {loading && <Text fz="xs" c="var(--text-muted)" fs="italic">{t('flow.skill.line_read.chat.firstLoad')}</Text>}
      {hint && !failed && !loading && <Text fz="xs" c="var(--text-muted)">{hint}</Text>}
      {!failed && !loading && selected.length === 0 && (
        <Text fz="xs" c="var(--text-muted)" fs="italic">{t('flow.skill.line_read.chat.blankHint')}</Text>
      )}
      {result !== null && !result.ok && (
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fz="xs" c="var(--mantine-color-warning)" style={{ flex: 1 }}>{result.message}</Text>
          {result.reason === 'disabled' ? (
            <AppButton
              variant="light"
              size="compact-xs"
              leftSection={<Settings size={12} />}
              onClick={() => openSettingsCategory('connectors')}
              style={{ flexShrink: 0 }}
            >
              {t('flow.setup.openSettings')}
            </AppButton>
          ) : (
            <AppButton
              variant="light"
              size="compact-xs"
              leftSection={<RefreshCw size={12} />}
              onClick={load}
              style={{ flexShrink: 0 }}
            >
              {t('flow.skill.line_read.chat.retry')}
            </AppButton>
          )}
        </Group>
      )}
    </Stack>
  );
};
