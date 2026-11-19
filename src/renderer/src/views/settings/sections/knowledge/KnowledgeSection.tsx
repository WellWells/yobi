import React, { useState } from 'react';
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { SearchSection } from '../../FreezeWhileHidden';
import { Library, MessageSquarePlus, Pencil, Plus, RefreshCw, Trash } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { SectionCard, SectionTitle, SettingDivider, SettingRow, StatusLine } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { knowledgeApi } from '../../../../api/electronApi';
import { useKnowledgeStore } from '../../../../store/useKnowledgeStore';
import { useAppStore } from '../../../../store/appStore';
import { useFormatTime } from '../../../../hooks/useFormatTime';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import type { KnowledgeBase } from '../../../../../../shared/knowledgeBase';
import type { KnowledgeStatus } from '../../../../../../shared/knowledgeStatus';
import { KnowledgeBaseForm } from './KnowledgeBaseForm';

interface Props {
  t: (key: string) => string;
  visible: boolean;
  sectionGap: number;
}

/** The status line under a base's folder: what the index holds, or what it is doing. */
function statusText(status: KnowledgeStatus | undefined, t: (key: string) => string, formatTime: (ts: string) => string): string {
  if (!status || (status.syncedAt === 0 && status.state === 'idle')) return t('settings.knowledge.status.never');
  if (status.state === 'indexing') {
    return status.total > 0
      ? fillTemplate(t('settings.knowledge.status.indexingCount'), { done: String(status.done), total: String(status.total) })
      : t('settings.knowledge.status.indexing');
  }
  const parts = [fillTemplate(t('settings.knowledge.status.files'), { count: String(status.files - status.failed) })];
  if (status.syncedAt > 0) parts.push(fillTemplate(t('settings.knowledge.status.synced'), { time: formatTime(new Date(status.syncedAt).toISOString()) }));
  return parts.join(' · ');
}

function BaseRow({ base, status, onEdit, t }: { base: KnowledgeBase; status: KnowledgeStatus | undefined; onEdit: () => void; t: (key: string) => string }) {
  const formatTime = useFormatTime();
  const startChat = useAppStore((s) => s.startKnowledgeChat);
  const indexing = status?.state === 'indexing';
  return (
    <Stack gap={4}>
      <SettingRow
        label={base.name}
        hint={(
          <>
            <Text span inherit display="block" style={{ wordBreak: 'break-all' }}>{base.folder}</Text>
            <Text span inherit display="block" style={{ fontVariantNumeric: 'tabular-nums' }}>{statusText(status, t, formatTime)}</Text>
          </>
        )}
        control={(
          <Group gap={2} wrap="nowrap">
            <Tooltip label={t('settings.knowledge.chat')} position="bottom">
              <ActionIcon variant="subtle" size={30} aria-label={t('settings.knowledge.chat')} onClick={() => startChat(base.id)}>
                <MessageSquarePlus size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('settings.knowledge.sync')} position="bottom">
              <ActionIcon variant="subtle" size={30} aria-label={t('settings.knowledge.sync')} disabled={indexing} onClick={() => { void knowledgeApi.sync(base.id); }}>
                <RefreshCw size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('settings.knowledge.edit')} position="bottom">
              <ActionIcon variant="subtle" size={30} aria-label={t('settings.knowledge.edit')} onClick={onEdit}>
                <Pencil size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('settings.knowledge.remove')} position="bottom">
              <ActionIcon variant="subtle" color="red" size={30} aria-label={t('settings.knowledge.remove')} onClick={() => { void knowledgeApi.remove(base.id); }}>
                <Trash size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      />
      {status?.folderMissing && <StatusLine tone="error">{t('settings.knowledge.status.folderMissing')}</StatusLine>}
      {!status?.folderMissing && status && status.failed > 0 && (
        <StatusLine tone="warning">{fillTemplate(t('settings.knowledge.status.unreadable'), { count: String(status.failed) })}</StatusLine>
      )}
      {status?.capped && <StatusLine tone="warning">{t('settings.knowledge.status.capped')}</StatusLine>}
    </Stack>
  );
}

/**
 * The knowledge bases: folders of the user's own documents the agent searches (`kb_search`). Each
 * row starts a chat with that base attached, re-reads the folder, or edits it in place; removing a
 * base drops its index, never the folder.
 */
export const KnowledgeSection: React.FC<Props> = ({ t, visible, sectionGap }) => {
  const { bases, statuses } = useKnowledgeStore(useShallow((s) => ({ bases: s.bases, statuses: s.statuses })));
  // The base being edited, or 'new' while adding one.
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <SearchSection shown={visible}>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle
          icon={<Library size={15} />}
          label={t('settings.knowledge.title')}
          rightSection={editing !== 'new' && (
            <AppButton variant="default" size="xs" leftSection={<Plus size={13} />} onClick={() => setEditing('new')}>
              {t('settings.knowledge.add')}
            </AppButton>
          )}
        />
        <Stack gap={12}>
          <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.6}>{t('settings.knowledge.hint')}</Text>
          {editing === 'new' && <KnowledgeBaseForm onDone={() => setEditing(null)} t={t} />}
          {bases.map((base, index) => (
            <React.Fragment key={base.id}>
              {(index > 0 || editing === 'new') && <SettingDivider my={0} />}
              {editing === base.id
                ? <KnowledgeBaseForm base={base} onDone={() => setEditing(null)} t={t} />
                : <BaseRow base={base} status={statuses[base.id]} onEdit={() => setEditing(base.id)} t={t} />}
            </React.Fragment>
          ))}
        </Stack>
      </SectionCard>
    </SearchSection>
  );
};
