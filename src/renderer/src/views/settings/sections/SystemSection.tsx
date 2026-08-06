import React, { useState } from 'react';
import { Box, Group, Stack, Button as MButton } from '@mantine/core';
import { DatabaseBackup, Download, FolderOpen, History, RotateCcw, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { SectionCard, GroupHeader, SectionTitle, SettingRow, SettingDivider } from '../components';
import { WebDialog } from '../../../components/WebDialog';
import { BackupExportModal } from '../backup/BackupExportModal';
import { BackupImportModal } from '../backup/BackupImportModal';
import type { BackupImportResult } from '../../../../../shared/types';
import { TAG_SETS } from '../hooks/useSettingsNav';

export type DangerAction = 'reset' | 'clear-history' | null;

interface Props {
  dangerAction: DangerAction;
  setDangerAction: (action: DangerAction) => void;
  onConfirmDangerAction: () => Promise<void>;
  onOpenConfigDir: () => Promise<void>;
  onBackupRestored: (result: BackupImportResult) => Promise<void> | void;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'system') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const SystemSection: React.FC<Props> = ({
  dangerAction, setDangerAction, onConfirmDangerAction,
  onOpenConfigDir, onBackupRestored,
  t, showSection, isSearching, sectionGap,
}) => {
  const isMac = navigator.userAgent.includes('Macintosh');
  const revealLabel = isMac ? t('settings.config.reveal.mac') : t('settings.config.reveal.win');

  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <Box>
      <Box display={showSection(TAG_SETS.config, 'system') ? 'block' : 'none'}>
        <SectionCard style={{ marginBottom: sectionGap }}>
          <SectionTitle icon={<DatabaseBackup size={15} />} label={t('settings.group.system')} />
          <Stack gap={12}>
            <SettingRow
              icon={<FolderOpen size={13} />}
              label={t('settings.config.openDir')}
              hint={t('settings.config.openDirHint')} control={
                <MButton
                  variant="default"
                  leftSection={<FolderOpen size={13} />}
                  onClick={() => { void onOpenConfigDir(); }}
                >
                  {revealLabel}
                </MButton>
              }
            />
            <SettingRow
              icon={<DatabaseBackup size={13} />}
              label={t('settings.config.backupRestore')}
              hint={t('settings.backup.row.hint')}
              control={
                <Group gap={8} wrap="nowrap">
                  <MButton
                    variant="default"
                    leftSection={<Download size={13} />}
                    onClick={() => setExportOpen(true)}
                  >
                    {t('settings.backup.export')}
                  </MButton>
                  <MButton
                    variant="default"
                    leftSection={<Upload size={13} />}
                    onClick={() => setImportOpen(true)}
                  >
                    {t('settings.backup.restore')}
                  </MButton>
                </Group>
              }
            />
          </Stack>
        </SectionCard>
      </Box>

      {isSearching && <GroupHeader label={t('settings.group.danger')} />}

      <Box display={showSection(TAG_SETS.danger, 'system') ? 'block' : 'none'}>
        <SectionCard danger style={{ marginBottom: 24 }}>
          <SectionTitle icon={<ShieldAlert size={15} />} label={t('settings.danger.title')} c="var(--mantine-color-error)" />
          <Stack gap={12}>
            <SettingRow
              icon={<History size={13} />}
              label={t('settings.danger.clearHistory')}
              hint={t('settings.danger.clearHistoryHint')} control={
                <MButton
                  variant="filled"
                  color="red"
                  leftSection={<Trash2 size={13} />}
                  style={{ flexShrink: 0 }}
                  miw={96}
                  onClick={() => setDangerAction('clear-history')}
                >
                  {t('common.delete')}
                </MButton>
              }
            />
            <SettingDivider danger />
            <SettingRow
              icon={<RotateCcw size={13} />}
              label={t('settings.reset')}
              hint={t('settings.reset.hint')} control={
                <MButton
                  variant="outline"
                  color="red"
                  leftSection={<RotateCcw size={13} />}
                  style={{ flexShrink: 0 }}
                  miw={96}
                  onClick={() => setDangerAction('reset')}
                >
                  {t('settings.reset.button')}
                </MButton>
              }
            />
          </Stack>
        </SectionCard>
      </Box>

      <BackupExportModal open={exportOpen} t={t} onClose={() => setExportOpen(false)} />
      <BackupImportModal
        open={importOpen}
        t={t}
        onClose={() => setImportOpen(false)}
        onImported={onBackupRestored}
      />

      <WebDialog
        open={dangerAction !== null}
        title={
          dangerAction === 'clear-history'
            ? t('settings.danger.clearHistoryTitle')
            : t('settings.danger.resetTitle')
        }
        description={
          dangerAction === 'clear-history'
            ? t('settings.danger.clearHistoryDetail')
            : t('settings.danger.resetDetail')
        }
        confirmText={
          dangerAction === 'clear-history'
            ? t('dialog.deleteAll')
            : t('settings.reset.button')
        }
        cancelText={t('dialog.cancel')}
        danger={dangerAction === 'clear-history' || dangerAction === 'reset'}
        onConfirm={onConfirmDangerAction}
        onCancel={() => setDangerAction(null)}
      />
    </Box>
  );
};
