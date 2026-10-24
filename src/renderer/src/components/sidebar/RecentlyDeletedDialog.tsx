import React, { useCallback, useEffect, useState } from 'react';
import { Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { TrashedConversation } from '../../../../shared/types';
import { formatCardTime } from '../../../../shared/captureCard';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { TRASH_RETENTION_DAYS } from '../../../../shared/conversationTrash';
import { trashApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useI18nStore } from '../../store/i18nStore';
import { Z_MODAL_CONFIRM } from '../../config/zLayers';
import { AppButton } from '../AppButton';
import { AppModal } from '../AppModal';
import { WebDialog } from '../WebDialog';
import { daysUntilPurge } from './conversationTrashActions';

interface RecentlyDeletedDialogProps {
  opened: boolean;
  onClose: () => void;
}

const META_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * Recently Deleted: each conversation with when it was deleted and how long it stays, to restore
 * or delete for good. Deleting everything asks first; it cannot be undone.
 */
export const RecentlyDeletedDialog: React.FC<RecentlyDeletedDialogProps> = ({ opened, onClose }) => {
  const { t, locale } = useI18nStore(useShallow((state) => ({ t: state.t, locale: state.locale })));
  const [items, setItems] = useState<TrashedConversation[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setItems(await trashApi.list().catch((): TrashedConversation[] => []));
  }, []);

  useEffect(() => {
    if (!opened) return undefined;
    setItems(null);
    void refresh();
    return trashApi.onChanged(() => { void refresh(); });
  }, [opened, refresh]);

  const restore = async (item: TrashedConversation): Promise<void> => {
    setBusyId(item.trashId);
    const restored = await trashApi.restore([item.trashId]).catch((): string[] => []);
    setBusyId(null);
    if (restored.length === 0) showAppNotice({ level: 'error', message: t('trash.restoreFailed') });
    await refresh();
  };

  const purge = async (which: string[] | 'all'): Promise<void> => {
    const purged = await trashApi.purge(which).catch(() => 0);
    if (purged === 0) showAppNotice({ level: 'error', message: t('trash.deleteFailed') });
    await refresh();
  };

  const body = (): React.ReactNode => {
    if (items === null) {
      return (
        <Group justify="center" py={40}>
          <Loader size="sm" color="var(--mantine-color-accent)" />
        </Group>
      );
    }
    if (items.length === 0) {
      return (
        <Stack align="center" gap={10} py={40} ta="center">
          <Trash2 size={32} strokeWidth={1.5} color="var(--text-muted)" />
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('trash.empty')}</Text>
        </Stack>
      );
    }
    const now = Date.now();
    return (
      <ScrollArea.Autosize mah="min(480px, 60vh)" type="auto">
        <Stack gap={0} pr={6}>
          {items.map((item) => (
            <Group
              key={item.trashId}
              wrap="nowrap"
              gap={12}
              py={10}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <Stack gap={2} flex={1} miw={0}>
                <Text fz="var(--font-size-sm)" fw={500} truncate title={item.title}>{item.title}</Text>
                <Text fz="var(--font-size-xs)" c="var(--text-muted)" style={META_STYLE}>
                  {fillTemplate(t('trash.deletedAt'), { time: formatCardTime(item.deletedAt, locale) })}
                  {' · '}
                  {fillTemplate(t('trash.daysLeft'), { count: daysUntilPurge(item.expiresAt, now) })}
                </Text>
              </Stack>
              <AppButton
                size="xs"
                variant="default"
                leftSection={<RotateCcw size={13} />}
                loading={busyId === item.trashId}
                aria-label={fillTemplate(t('trash.restoreItem'), { title: item.title })}
                onClick={() => { void restore(item); }}
              >
                {t('trash.restore')}
              </AppButton>
              <AppButton
                size="xs"
                variant="subtle"
                color="red"
                disabled={busyId === item.trashId}
                aria-label={fillTemplate(t('trash.deleteNowItem'), { title: item.title })}
                onClick={() => { void purge([item.trashId]); }}
              >
                {t('trash.deleteNow')}
              </AppButton>
            </Group>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    );
  };

  return (
    <>
      <AppModal opened={opened} onClose={onClose} title={t('trash.title')} icon={<Trash2 size={18} />} size="lg">
        <Text fz="var(--font-size-sm)" c="var(--text-secondary)" mb="sm">
          {fillTemplate(t('trash.retentionNote'), { count: TRASH_RETENTION_DAYS })}
        </Text>
        {body()}
        <Group justify="flex-end" mt="md">
          <AppButton
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<Trash2 size={13} />}
            disabled={!items || items.length === 0}
            onClick={() => setConfirmAll(true)}
          >
            {t('trash.deleteAll')}
          </AppButton>
        </Group>
      </AppModal>
      <WebDialog
        open={confirmAll}
        title={fillTemplate(t('trash.deleteAll.title'), { count: items?.length ?? 0 })}
        description={t('trash.deleteAll.body')}
        confirmText={t('trash.deleteAll.confirm')}
        cancelText={t('dialog.cancel')}
        danger
        zIndex={Z_MODAL_CONFIRM}
        onConfirm={() => {
          setConfirmAll(false);
          void purge('all');
        }}
        onCancel={() => setConfirmAll(false)}
      />
    </>
  );
};
