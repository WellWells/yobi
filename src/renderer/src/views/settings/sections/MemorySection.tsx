import React, { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Box, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { Brain, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useUserMemoryStore } from '../../../store/userMemoryStore';
import { MemoryCurateModal } from './MemoryCurateModal';
import { AppButton } from '../../../components/AppButton';
import { useAppStore } from '../../../store/appStore';
import { WebDialog } from '../../../components/WebDialog';
import { EmptyState } from '../../../components/EmptyState';
import { GroupHeader } from '../../../components/GroupHeader';
import { SectionCard, SectionTitle, SettingDivider, SettingField, SettingRow, StatusLine, ToggleSwitch } from '../components';
import { buildTimeGroupHeads } from '../../../utils/timeGroups';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useUserMemory } from '../hooks/useUserMemory';
import { MemoryEntryForm } from './MemoryEntryForm';
import { ownerAccountLabels } from './botPermissionsView';
import type { BotRoster } from './botPermissionsView';
import { memoryNearlyFull } from '../../../../../shared/userMemory';
import type { UserMemoryEntry } from '../../../../../shared/userMemory';
import { fillTemplate } from '../../../../../shared/fillTemplate';

type UserMemory = ReturnType<typeof useUserMemory>;

interface Props {
  memory: UserMemory;
  /** Paired bot accounts; the owner ("me") mark is shown here and edited in the paired lists. */
  roster: BotRoster;
  t: (key: string) => string;
  locale: string;
  showSection: (tags: readonly string[], category: 'memory') => boolean;
  sectionGap: number;
}

const EntryRow: React.FC<{
  entry: UserMemoryEntry;
  memory: UserMemory;
  maxChars: number;
  t: (key: string) => string;
  onRequestDelete: (entry: UserMemoryEntry) => void;
}> = ({ entry, memory, maxChars, t, onRequestDelete }) => {
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
            {/* Confirmed first: forgetting is final, no backup is kept. */}
            <ActionIcon variant="subtle" size={26} aria-label={t('settings.memory.delete')} onClick={() => onRequestDelete(entry)}>
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
  memory, roster, t, locale, showSection, sectionGap,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<UserMemoryEntry | null>(null);
  const [curate, setCurate] = useState<{ focus: string } | null>(null);
  const curateRequest = useUserMemoryStore((s) => s.curateRequest);
  const snapshot = memory.snapshot;

  // A chat reply asked for a tidy: take the request once, so reopening Settings does not repeat it.
  useEffect(() => {
    if (!curateRequest) return;
    setCurate({ focus: curateRequest.focus });
    useUserMemoryStore.getState().clearCurateRequest();
  }, [curateRequest]);
  const ownerLabels = useMemo(() => ownerAccountLabels(roster, t), [roster, t]);

  // Show a busy placeholder while the snapshot loads, so the nav entry never lands on an empty page.
  if (!snapshot) {
    return (
      <Box display={showSection(TAG_SETS.memory, 'memory') ? 'block' : 'none'}>
        <EmptyState icon={Brain} label="" busy />
      </Box>
    );
  }
  const visible = showSection(TAG_SETS.memory, 'memory');
  const full = memoryNearlyFull(snapshot.usedChars);
  // Entries are stored oldest first, so the buckets of when Yobi learned them already run in order.
  const groupHeads = buildTimeGroupHeads(snapshot.entries.map((entry) => entry.createdAt), new Date());

  return (
    <Box display={visible ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle
          icon={<Brain size={15} />}
          label={t('settings.memory.list')}
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
            label={t('settings.memory.enabled')}
            hint={t('settings.memory.enabled.hint')}
            control={<ToggleSwitch checked={snapshot.enabled} onChange={() => { void memory.setEnabled(!snapshot.enabled); }} />}
          />
          <SettingDivider />
          <Stack gap={4}>
            <Group justify="space-between" gap={8}>
              <Text fz="var(--font-size-sm)" c="dimmed">
                {fillTemplate(t('settings.memory.usage'), { used: snapshot.usedChars.toLocaleString(locale), max: snapshot.maxChars.toLocaleString(locale) })}
              </Text>
              <Text fz="var(--font-size-sm)" c="dimmed">
                {fillTemplate(t('settings.memory.count'), { count: String(snapshot.entries.length) })}
              </Text>
            </Group>
            <Progress
              value={Math.min(100, (snapshot.usedChars / snapshot.maxChars) * 100)}
              size="xs"
              color={full ? 'var(--mantine-color-warning)' : 'brand'}
              aria-label={t('settings.memory.title')}
            />
            {full && (
              <StatusLine tone="warning">{t('settings.memory.full')}</StatusLine>
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
                <EntryRow entry={entry} memory={memory} maxChars={snapshot.entryMaxChars} t={t} onRequestDelete={setConfirmDelete} />
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
          label={t('settings.memory.bots')}
          hint={t('settings.memory.bots.hint')}
        >
          {/* Read-only: the owner mark has one editor, the "Me" chip in the bots' paired lists. */}
          <Group justify="space-between" align="center" gap={8} wrap="nowrap">
            <Text
              fz="var(--font-size-sm)"
              c={ownerLabels.length > 0 ? 'var(--mantine-color-default-color)' : 'dimmed'}
              fs={ownerLabels.length > 0 ? undefined : 'italic'}
              style={{ minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {ownerLabels.length > 0
                ? ownerLabels.join(t('settings.bot.perm.who.separator'))
                : t(roster.accounts.length > 0 ? 'settings.memory.bots.unset' : 'settings.memory.bots.none')}
            </Text>
            <AppButton
              variant="default"
              size="xs"
              style={{ flexShrink: 0 }}
              onClick={() => useAppStore.getState().openSettingsCategory('bots')}
            >
              {t('settings.memory.bots.open')}
            </AppButton>
          </Group>
        </SettingField>
      </SectionCard>

      <WebDialog
        open={confirmDelete !== null}
        title={t('settings.memory.delete.title')}
        description={confirmDelete?.text ?? ''}
        confirmText={t('common.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void memory.remove(target.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

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
