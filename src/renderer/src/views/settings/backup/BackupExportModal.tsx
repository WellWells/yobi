import React, { useCallback, useEffect, useState } from 'react';
import { Stack, Group, Text, Checkbox } from '@mantine/core';
import { Download } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppModal } from '../../../components/AppModal';
import { backupApi } from '../../../api/electronApi';
import { BACKUP_CATEGORY_IDS } from '../../../../../shared/types';
import type { BackupCategoryId, BackupCategoryInfo } from '../../../../../shared/types';
import { Z_MODAL } from '../../../config/zLayers';

interface Props {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
}

function countLabel(t: (key: string) => string, id: BackupCategoryId, info?: BackupCategoryInfo): string {
  if (!info?.available) return t('settings.backup.unavailable');
  if (id === 'config') return '';
  return t(`settings.backup.count.${id}`).replace('{{count}}', String(info.count));
}

export const BackupExportModal: React.FC<Props> = ({ open, t, onClose }) => {
  const [infos, setInfos] = useState<BackupCategoryInfo[]>([]);
  const [selected, setSelected] = useState<Set<BackupCategoryId>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    void backupApi.getCategories().then((list) => {
      if (!active) return;
      setInfos(list);
      setSelected(new Set(list.filter((info) => info.available).map((info) => info.id)));
    });
    return () => { active = false; };
  }, [open]);

  const toggle = useCallback((id: BackupCategoryId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const ordered = BACKUP_CATEGORY_IDS.filter((id) => selected.has(id));
      const result = await backupApi.export(ordered);
      if (result.ok || result.canceled) onClose();
      else setError(t('settings.backup.export.failed'));
    } finally {
      setBusy(false);
    }
  }, [selected, onClose, t]);

  const infoById = new Map(infos.map((info) => [info.id, info]));
  const anyAvailable = infos.some((info) => info.available);

  return (
    <AppModal
      opened={open}
      onClose={onClose}
      title={t('settings.backup.export.title')}
      icon={<Download size={16} />}
      size="md"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        <Text fz="sm" c="dimmed">{t('settings.backup.export.desc')}</Text>

        {infos.length > 0 && !anyAvailable ? (
          <Text fz="sm" c="dimmed">{t('settings.backup.export.empty')}</Text>
        ) : (
          <Stack gap={16}>
            {BACKUP_CATEGORY_IDS.map((id) => {
              const info = infoById.get(id);
              const available = info?.available ?? false;
              return (
                <Checkbox
                  key={id}
                  checked={selected.has(id)}
                  disabled={!available}
                  onChange={() => toggle(id)}
                  styles={{ body: { alignItems: 'flex-start' }, labelWrapper: { flex: 1 } }}
                  label={
                    <Stack gap={3}>
                      <Group justify="space-between" wrap="nowrap" gap="sm" align="baseline">
                        <Text fz="sm" fw={600}>{t(`settings.backup.category.${id}`)}</Text>
                        <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {countLabel(t, id, info)}
                        </Text>
                      </Group>
                      <Text fz="xs" c="dimmed" lh={1.45}>{t(`settings.backup.desc.${id}`)}</Text>
                    </Stack>
                  }
                />
              );
            })}
          </Stack>
        )}

        <Text fz="xs" c="dimmed">{t('settings.backup.secretsNote')}</Text>

        {error && <Text fz="xs" c="red">{error}</Text>}

        <Group justify="flex-end">
          <AppButton
            variant="filled"
            leftSection={<Download size={14} />}
            loading={busy}
            disabled={selected.size === 0 || !anyAvailable}
            onClick={() => { void handleExport(); }}
          >
            {t('settings.backup.export.submit')}
          </AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
};
