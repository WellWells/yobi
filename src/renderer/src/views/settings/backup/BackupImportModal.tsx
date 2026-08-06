import React, { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Box, Flex, Group, Stack, Text, Checkbox } from '@mantine/core';
import { FileArchive, Upload } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppModal } from '../../../components/AppModal';
import { backupApi, systemApi } from '../../../api/electronApi';
import { BACKUP_CATEGORY_IDS } from '../../../../../shared/types';
import type {
  BackupCategoryId,
  BackupImportResult,
  BackupInspectResult,
} from '../../../../../shared/types';
import { Z_MODAL } from '../../../config/zLayers';

interface Props {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onImported: (result: BackupImportResult) => Promise<void> | void;
}

function impactText(
  t: (key: string) => string,
  id: BackupCategoryId,
  incoming: number,
  current: number,
): string {
  const suffix = id === 'config' ? 'config' : id === 'outputs' ? 'outputs' : 'replace';
  return t(`settings.backup.impact.${suffix}`)
    .replace('{{incoming}}', String(incoming))
    .replace('{{current}}', String(current));
}

export const BackupImportModal: React.FC<Props> = ({ open, t, onClose, onImported }) => {
  const [zipPath, setZipPath] = useState('');
  const [inspect, setInspect] = useState<BackupInspectResult | null>(null);
  const [selected, setSelected] = useState<Set<BackupCategoryId>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setZipPath('');
    setInspect(null);
    setSelected(new Set());
    setError('');
    setBusy(false);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const inspectPath = useCallback(async (path: string) => {
    if (!path) {
      setError(t('settings.backup.import.invalid'));
      return;
    }
    setError('');
    const result = await backupApi.inspect(path);
    if (!result.valid || result.items.length === 0) {
      setError(t('settings.backup.import.invalid'));
      return;
    }
    setZipPath(path);
    setInspect(result);
    setSelected(new Set(result.items.map((item) => item.id)));
  }, [t]);

  const handleChoose = useCallback(async () => {
    const picked = await systemApi.selectPath({
      mode: 'file',
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (!picked) return;
    await inspectPath(picked.path);
  }, [inspectPath]);

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    void inspectPath(systemApi.getPathForFile(file));
  }, [inspectPath]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'] },
    multiple: false,
    noKeyboard: true,
  });

  const toggle = useCallback((id: BackupCategoryId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRestore = useCallback(async () => {
    if (!zipPath || selected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      const ordered = BACKUP_CATEGORY_IDS.filter((id) => selected.has(id));
      const result = await backupApi.import(zipPath, ordered);
      if (!result.ok) {
        setError(t('settings.backup.import.failed'));
        return;
      }
      try {
        await onImported(result);
      } catch {
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }, [zipPath, selected, onImported, onClose, t]);

  const metaLine = inspect
    ? t('settings.backup.import.meta')
      .replace('{{date}}', inspect.createdAt ? new Date(inspect.createdAt).toLocaleString() : '—')
      .replace('{{version}}', inspect.appVersion ?? '—')
    : '';

  return (
    <AppModal
      opened={open}
      onClose={onClose}
      title={inspect ? t('settings.backup.import.warningTitle') : t('settings.backup.import.title')}
      icon={<Upload size={16} />}
      size="md"
      zIndex={Z_MODAL}
    >
      {!inspect ? (
        <Stack gap="md">
          <Box {...getRootProps()}>
            <input {...getInputProps()} />
            <Flex
              direction="column"
              align="center"
              justify="center"
              gap="sm"
              py={32}
              px={20}
              style={{
                border: '2px dashed var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-md)',
                background: isDragActive ? 'var(--mantine-color-accent-dim)' : 'var(--mantine-color-default)',
              }}
            >
              <FileArchive size={32} color="var(--mantine-color-dimmed)" />
              <Text fz="sm" c="dimmed" ta="center">{t('settings.backup.import.drop')}</Text>
            </Flex>
          </Box>
          <Group justify="center">
            <AppButton
              variant="default"
              leftSection={<Upload size={14} />}
              onClick={() => { void handleChoose(); }}
            >
              {t('settings.backup.import.choose')}
            </AppButton>
          </Group>
          {error && <Text fz="xs" c="red" ta="center">{error}</Text>}
        </Stack>
      ) : (
        <Stack gap="md">
          <Text fz="xs" c="dimmed">{metaLine}</Text>
          <Text fz="sm" c="var(--mantine-color-error)">{t('settings.backup.import.warningDesc')}</Text>

          <Stack gap={10}>
            {inspect.items.map((item) => (
              <Checkbox
                key={item.id}
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                label={
                  <Stack gap={0}>
                    <Text fz="sm">{t(`settings.backup.category.${item.id}`)}</Text>
                    <Text fz="xs" c={item.id === 'outputs' ? 'var(--mantine-color-error)' : 'dimmed'}>
                      {impactText(t, item.id, item.incomingCount, item.currentCount)}
                    </Text>
                  </Stack>
                }
              />
            ))}
          </Stack>

          <Text fz="xs" c="dimmed">{t('settings.backup.secretsNote')}</Text>

          <Group justify="space-between">
            <AppButton variant="default" onClick={reset} disabled={busy}>
              {t('settings.backup.import.back')}
            </AppButton>
            <AppButton
              variant="filled"
              color="red"
              leftSection={<Upload size={14} />}
              loading={busy}
              disabled={selected.size === 0}
              onClick={() => { void handleRestore(); }}
            >
              {t('settings.backup.import.submit')}
            </AppButton>
          </Group>
          {error && <Text fz="xs" c="red">{error}</Text>}
        </Stack>
      )}
    </AppModal>
  );
};
