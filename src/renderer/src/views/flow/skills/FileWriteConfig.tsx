import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { PathInput } from '../../../components/PathInput';
import { FieldPair } from './FieldPair';
import type { SkillConfigProps } from './types';

/** A file name that is a whole path on its own: the runner then ignores the folder. */
export function isAbsoluteFileName(raw: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(raw.trim());
}

export const FileWriteConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const folderUnused = (step.config.folder ?? '').trim() !== '' && isAbsoluteFileName(step.config.filename ?? '');
  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.file_write.content')}
        placeholder={t('flow.skill.file_write.content.placeholder')}
        value={step.config.content ?? ''}
        onChange={(e) => onChange({ ...step.config, content: e.currentTarget.value })}
        minRows={3}
        maxRows={12}
        autosize
        size="sm"
      />
      {/* Where first, then what to call it: the order of the path it writes. */}
      <FieldPair>
        <PathInput
          label={t('flow.skill.file_write.folder')}
          placeholder={t('flow.skill.file_write.folder.placeholder')}
          browseLabel={t('flow.path.browse')}
          mode="folder"
          value={step.config.folder ?? ''}
          onChange={(folder) => onChange({ ...step.config, folder })}
          size="sm"
        />
        <AppTextInput
          label={t('flow.skill.file_write.filename')}
          placeholder={t('flow.skill.file_write.filename.placeholder')}
          value={step.config.filename ?? ''}
          onChange={(e) => onChange({ ...step.config, filename: e.currentTarget.value })}
          size="sm"
          mono
        />
      </FieldPair>
      {folderUnused && <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.skill.file_write.folderUnused')}</Text>}
      <Text fz="xs" c="dimmed">{t('flow.skill.file_write.hint')}</Text>
    </Stack>
  );
};
