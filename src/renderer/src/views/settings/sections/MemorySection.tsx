import React, { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Box, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { Brain, MessagesSquare, Pencil, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { useUserMemoryStore } from '../../../store/userMemoryStore';
import { MemoryCurateModal } from './MemoryCurateModal';
import { AppButton } from '../../../components/AppButton';
import { MultiSelectDropdown } from '../../../components/MultiSelectDropdown';
import { WebDialog } from '../../../components/WebDialog';
import { GroupHeader } from '../../../components/GroupHeader';
import { SectionCard, SectionTitle, SettingDivider, SettingField, SettingRow, ToggleSwitch } from '../components';
import { buildTimeGroupHeads } from '../../../utils/timeGroups';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useUserMemory } from '../hooks/useUserMemory';
import { MemoryEntryForm } from './MemoryEntryForm';
import type { LinePairedUser, TelegramPairedUser } from '../../../../../shared/types';
import { memoryNearlyFull } from '../../../../../shared/userMemory';
import type { UserMemoryEntry } from '../../../../../shared/userMemory';

type UserMemory = ReturnType<typeof useUserMemory>;

interface Props {
  memory: UserMemory;
  telegramUsers: TelegramPairedUser[];
  lineUsers: LinePairedUser[];
  t: (key: string) => string;
  locale: string;
  showSection: (tags: readonly string[], category: 'memory') => boolean;
  sectionGap: number;
}

function telegramLabel(user: TelegramPairedUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || (user.username ? `@${user.username}` : `ID ${user.userId}`);
}

const EntryRow: React.FC<{
  entry: UserMemoryEntry;
  memory: UserMemory;
  maxChars: number;
  t: (key: string) => string;
}> = ({ entry, memory, maxChars, t }) => {
  const editing = memory.formTarget === entry.id;
  return (
    <Box>
      <Group
        justify="space-between"
        align="flex-start"
        gap={8}
        wrap="nowrap"
        p="6px 8px"
        bg="var(--mantine-color-bg-tertiary)"
        style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
      >
        <Text
          fz="var(--font-size-base)"
          c="var(--mantine-color-default-color)"
          style={{ minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {entry.text}
        </Text>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={t('settings.memory.edit')} position="top">
            <ActionIcon variant="subtle" size={26} aria-label={t('settings.memory.edit')} onClick={() => memory.openForm(entry.id)}>
              <Pencil size={13} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('settings.memory.delete')} position="top">
            <ActionIcon variant="subtle" size={26} aria-label={t('settings.memory.delete')} onClick={() => { void memory.remove(entry.id); }}>
              <Trash2 size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {editing && (
        <MemoryEntryForm
          initial={entry.text}
          maxChars={maxChars}
          busy={memory.busy}
          error={memory.error}
          submitLabel={t('settings.memory.save')}
          onSave={(text) => { void memory.save(text); }}
          onCancel={() => memory.openForm(null)}
          t={t}
        />
      )}
    </Box>
  );
};

export const MemorySection: React.FC<Props> = ({
  memory, telegramUsers, lineUsers, t, locale, showSection, sectionGap,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [curate, setCurate] = useState<{ focus: string } | null>(null);
  const curateRequest = useUserMemoryStore((s) => s.curateRequest);
  const snapshot = memory.snapshot;

  // A chat reply asked for a tidy: take the request once, so reopening Settings does not repeat it.
  useEffect(() => {
    if (!curateRequest) return;
    setCurate({ focus: curateRequest.focus });
    useUserMemoryStore.getState().clearCurateRequest();
  }, [curateRequest]);
  const botOptions = useMemo(() => [
    ...(telegramUsers.length > 0
      ? [{ group: 'Telegram', items: telegramUsers.map((user) => ({ value: `telegram:${user.userId}`, label: telegramLabel(user) })) }]
      : []),
    ...(lineUsers.length > 0
      ? [{ group: 'LINE', items: lineUsers.map((user) => ({ value: `line:${user.userId}`, label: user.displayName || user.userId })) }]
      : []),
  ], [telegramUsers, lineUsers]);

  if (!snapshot) return null;
  const visible = showSection(TAG_SETS.memory, 'memory');
  const full = memoryNearlyFull(snapshot.usedChars);
  // Entries are stored oldest first, so the buckets of when Yobi learned them already run in order.
  const groupHeads = buildTimeGroupHeads(snapshot.entries.map((entry) => entry.createdAt), new Date());
  const paired = new Set(botOptions.flatMap((group) => group.items.map((item) => item.value)));
  const botValue = [
    ...snapshot.botSelf.telegram.map((id) => `telegram:${id}`),
    ...snapshot.botSelf.line.map((id) => `line:${id}`),
  ].filter((value) => paired.has(value));

  const handleBotChange = (values: string[]): void => {
    const pick = (platform: string): string[] => values
      .filter((value) => value.startsWith(`${platform}:`))
      .map((value) => value.slice(platform.length + 1));
    void memory.setBotSelf({ telegram: pick('telegram'), line: pick('line') });
  };

  return (
    <Box display={visible ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle
          icon={<Brain size={15} />}
          label={t('settings.memory.title')}
          rightSection={(
            <Group gap={8} wrap="nowrap">
              <AppButton
                variant="default"
                size="xs"
                leftSection={<Plus size={13} />}
                disabled={memory.formTarget === 'new'}
                onClick={() => memory.openForm('new')}
              >
                {t('settings.memory.add')}
              </AppButton>
              {snapshot.entries.length > 0 && (
                <AppButton variant="default" size="xs" leftSection={<Sparkles size={13} />} onClick={() => setCurate({ focus: '' })}>
                  {t('settings.memory.curate')}
                </AppButton>
              )}
            </Group>
          )}
        />
        <Stack gap={12}>
          <SettingRow
            icon={<Brain size={13} />}
            label={t('settings.memory.enabled')}
            hint={t('settings.memory.enabled.hint')}
            control={<ToggleSwitch checked={snapshot.enabled} onChange={() => { void memory.setEnabled(!snapshot.enabled); }} />}
          />
          <SettingDivider />
          <Stack gap={4}>
            <Group justify="space-between" gap={8}>
              <Text fz="var(--font-size-sm)" c="dimmed">
                {t('settings.memory.usage')
                  .replace('{{used}}', snapshot.usedChars.toLocaleString(locale))
                  .replace('{{max}}', snapshot.maxChars.toLocaleString(locale))}
              </Text>
              <Text fz="var(--font-size-sm)" c="dimmed">
                {t('settings.memory.count').replace('{{count}}', String(snapshot.entries.length))}
              </Text>
            </Group>
            <Progress
              value={Math.min(100, (snapshot.usedChars / snapshot.maxChars) * 100)}
              size="xs"
              color={full ? 'orange' : 'brand'}
              aria-label={t('settings.memory.title')}
            />
            {full && (
              <Group gap={6} wrap="nowrap" align="flex-start" mt={2}>
                <Box c="orange" mt={2} style={{ flexShrink: 0 }}><TriangleAlert size={13} /></Box>
                <Text fz="var(--font-size-sm)" c="orange">{t('settings.memory.full')}</Text>
              </Group>
            )}
          </Stack>

          <Stack gap={6}>
            {snapshot.entries.length === 0 && memory.formTarget !== 'new' && (
              <Text fz="var(--font-size-sm)" c="dimmed" fs="italic">{t('settings.memory.empty')}</Text>
            )}
            {snapshot.entries.map((entry, index) => (
              <React.Fragment key={entry.id}>
                {groupHeads[index] && (
                  // Same time buckets as the conversation sidebar, so they share its labels.
                  <GroupHeader label={t(`sidebar.group.${groupHeads[index]}`)} />
                )}
                <EntryRow entry={entry} memory={memory} maxChars={snapshot.entryMaxChars} t={t} />
              </React.Fragment>
            ))}
            {memory.formTarget === 'new' && (
              <MemoryEntryForm
                initial=""
                maxChars={snapshot.entryMaxChars}
                busy={memory.busy}
                error={memory.error}
                submitLabel={t('settings.memory.add')}
                placeholder={t('settings.memory.add.placeholder')}
                onSave={(text) => { void memory.save(text); }}
                onCancel={() => memory.openForm(null)}
                t={t}
              />
            )}
          </Stack>

          {snapshot.entries.length > 0 && (
            <Group justify="flex-end" gap={8}>
              <AppButton variant="outline" color="red" size="xs" leftSection={<Trash2 size={13} />} onClick={() => setConfirmClear(true)}>
                {t('settings.memory.clear')}
              </AppButton>
            </Group>
          )}
        </Stack>
      </SectionCard>

      <SectionCard style={{ marginBottom: sectionGap }}>
        <SettingField
          icon={<MessagesSquare size={13} />}
          label={t('settings.memory.bots')}
          hint={t('settings.memory.bots.hint')}
        >
          {botOptions.length === 0
            ? <Text fz="var(--font-size-sm)" c="dimmed" fs="italic">{t('settings.memory.bots.none')}</Text>
            : (
              <MultiSelectDropdown
                value={botValue}
                options={botOptions}
                onChange={handleBotChange}
                placeholder={botValue.length === 0 ? t('settings.memory.bots.placeholder') : undefined}
                aria-label={t('settings.memory.bots')}
              />
            )}
        </SettingField>
      </SectionCard>

      <WebDialog
        open={confirmClear}
        title={t('settings.memory.clear.title')}
        description={t('settings.memory.clear.detail')}
        confirmText={t('dialog.deleteAll')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => { setConfirmClear(false); void memory.clearAll(); }}
        onCancel={() => setConfirmClear(false)}
      />

      <MemoryCurateModal
        open={curate !== null}
        focus={curate?.focus ?? ''}
        snapshot={snapshot}
        onClose={() => setCurate(null)}
        t={t}
        locale={locale}
      />
    </Box>
  );
};
