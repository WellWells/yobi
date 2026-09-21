import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { RefreshCw, Settings } from 'lucide-react';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { lineApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import type { LineChatListResult } from '../../../shared/types';

export interface LineChatPickerProps {
  /** Comma-separated chat ids, exactly as the step config stores them. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
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
 * computer, grouped by kind with the bare chat name as the label — the chat model menu does the
 * same, and a "（群組）" suffix on every row only repeats what its group heading already says.
 *
 * Selecting NOTHING means every chat: a step with no chats reads the whole account as one
 * combined search. There is deliberately no "all chats" entry — a sentinel inside a multi-select
 * has to clear the other rows to mean anything, and that is a trap.
 *
 * A chat id absent from the list (a flow carried over from another machine) is kept as its own
 * option rather than silently dropped.
 */
export const LineChatPicker: React.FC<LineChatPickerProps> = ({ value, onChange, label, hint }) => {
  const t = useI18nStore((s) => s.t);
  const setView = useAppStore((s) => s.setView);
  const currentView = useAppStore((s) => s.currentView);
  const [result, setResult] = useState<LineChatListResult | null>(null);

  const load = useCallback(() => {
    setResult(null);
    void lineApi.listChats().then(setResult);
  }, []);

  useEffect(() => {
    if (currentView !== 'flow') return;
    load();
  }, [currentView, load]);

  const selected = useMemo(() => splitIds(value), [value]);

  const options = useMemo(() => {
    if (!result?.ok) return [];
    const byGroup = new Map<string, { value: string; label: string }[]>();
    for (const chat of result.chats) {
      const key = (GROUP_ORDER as readonly string[]).includes(chat.type) ? chat.type : 'unknown';
      const bucket = byGroup.get(key) ?? [];
      bucket.push({ value: chat.id, label: chat.name });
      byGroup.set(key, bucket);
    }
    const groups = GROUP_ORDER
      .filter((key) => byGroup.has(key))
      .map((key) => ({ group: t(`flow.skill.line_read.chatGroup.${key}`), items: byGroup.get(key) ?? [] }));

    const known = new Set(result.chats.map((chat) => chat.id));
    const orphans = selected.filter((id) => !known.has(id)).map((id) => ({ value: id, label: id }));
    if (orphans.length === 0) return groups;
    return [...groups, { group: t('flow.skill.line_read.chatGroup.unavailable'), items: orphans }];
  }, [result, selected, t]);

  const loading = result === null;
  const failed = result !== null && !result.ok;

  return (
    <Stack gap={4}>
      <MultiSelectDropdown
        label={label}
        options={options}
        value={selected}
        onChange={(next) => onChange(next.join(','))}
        searchable
        clearable
        nothingFoundMessage={t('flow.skill.line_read.chat.noMatch')}
        placeholder={loading ? t('flow.skill.line_read.chat.loading') : t('flow.skill.line_read.chat.placeholder')}
        disabled={loading || failed}
        size="sm"
      />
      {loading && <Text fz="xs" c="dimmed" fs="italic">{t('flow.skill.line_read.chat.firstLoad')}</Text>}
      {hint && !failed && !loading && <Text fz="xs" c="dimmed">{hint}</Text>}
      {!failed && !loading && selected.length === 0 && (
        <Text fz="xs" c="dimmed" fs="italic">{t('flow.skill.line_read.chat.blankHint')}</Text>
      )}
      {result !== null && !result.ok && (
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fz="xs" c="orange" style={{ flex: 1 }}>{result.message}</Text>
          {result.reason === 'disabled' ? (
            <Button
              variant="light"
              size="compact-xs"
              leftSection={<Settings size={12} />}
              onClick={() => setView('settings')}
              style={{ flexShrink: 0 }}
            >
              {t('flow.setup.openSettings')}
            </Button>
          ) : (
            <Button
              variant="light"
              size="compact-xs"
              leftSection={<RefreshCw size={12} />}
              onClick={load}
              style={{ flexShrink: 0 }}
            >
              {t('flow.skill.line_read.chat.retry')}
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
};
