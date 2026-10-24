import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import type { TriggerConfig } from '../../../../shared/types';
import { isUsableWatchFolder } from '../../../../shared/flowFileTrigger';
import { PathInput } from '../../components/PathInput';
import { AppTextInput } from '../../components/AppTextInput';
import { ToggleSwitch } from '../../components/ToggleSwitch';

interface FileTriggerFieldsProps {
  value: TriggerConfig;
  patch: (p: Partial<TriggerConfig>) => void;
  t: (k: string) => string;
  /** The app cannot find the folder right now (it waits for it to come back). */
  folderMissing?: boolean;
  cardStyle?: React.CSSProperties;
}

/** Each field: label → field → error → hint, as in the rest of the flow settings. */
export const FileTriggerFields: React.FC<FileTriggerFieldsProps> = ({ value, patch, t, folderMissing = false, cardStyle }) => {
  const folder = value.watchFolder ?? '';
  const folderError = folder.trim() && !isUsableWatchFolder(folder)
    ? t('flow.trigger.file.folderInvalid')
    : folderMissing ? t('flow.trigger.file.folderMissing') : undefined;

  return (
    <Box p="sm" style={cardStyle}>
      <Stack gap="sm">
        <Stack gap={4}>
          <PathInput
            label={t('flow.trigger.file.folder')}
            placeholder={t('flow.trigger.file.folder.placeholder')}
            browseLabel={t('flow.path.browse')}
            mode="folder"
            value={folder}
            error={folderError}
            onChange={(watchFolder) => patch({ watchFolder })}
            size="sm"
          />
          <Text fz="xs" c="dimmed">{t('flow.trigger.file.hint')}</Text>
        </Stack>
        <Stack gap={4}>
          <AppTextInput
            label={t('flow.trigger.file.pattern')}
            placeholder={t('flow.trigger.file.pattern.placeholder')}
            value={value.watchPattern ?? ''}
            onChange={(e) => patch({ watchPattern: e.currentTarget.value })}
            size="sm"
            mono
          />
          <Text fz="xs" c="dimmed">{t('flow.trigger.file.pattern.hint')}</Text>
        </Stack>
        <ToggleSwitch
          label={t('flow.trigger.file.subfolders')}
          size="sm"
          checked={value.watchSubfolders === true}
          onChange={(e) => patch({ watchSubfolders: e.currentTarget.checked })}
        />
      </Stack>
    </Box>
  );
};
