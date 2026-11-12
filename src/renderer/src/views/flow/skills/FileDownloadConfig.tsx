import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { PathInput } from '../../../components/PathInput';
import { FieldPair } from './FieldPair';
import { isValidDownloadUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';

/** Why the URL will not download, as the runner would refuse it; null when it will. */
export function downloadUrlError(url: string): 'httpsOnly' | 'invalid' | null {
  if (isValidDownloadUrlOrVar(url)) return null;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url.trim()) ? 'httpsOnly' : 'invalid';
}

export const FileDownloadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = downloadUrlError(url);
  const folder = step.config.folder ?? '';
  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.file_download.url')}
        placeholder={t('flow.skill.file_download.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        mono
        error={urlError === 'httpsOnly'
          ? t('flow.skill.file_download.url.httpsOnly')
          : urlError ? t('flow.skill.file_download.url.error') : undefined}
      />
      <PathInput
        label={t('flow.skill.file_download.folder')}
        placeholder={t('flow.skill.file_download.folder.placeholder')}
        browseLabel={t('flow.path.browse')}
        mode="folder"
        value={folder}
        onChange={(next) => onChange({ ...step.config, folder: next })}
        size="sm"
      />
      {folder.trim() === '' && (
        <Text fz="xs" c="var(--text-muted)">{t('flow.skill.file_download.folder.retention')}</Text>
      )}
      <FieldPair>
        <AppTextInput
          label={t('flow.skill.file_download.filename')}
          placeholder={t('flow.skill.file_download.filename.placeholder')}
          description={t('flow.skill.file_download.filename.hint')}
          value={step.config.filename ?? ''}
          onChange={(e) => onChange({ ...step.config, filename: e.currentTarget.value })}
          size="sm"
          mono
        />
        <AppNumberInput
          label={t('flow.skill.file_download.maxSizeMb')}
          description={t('flow.skill.file_download.maxSizeMb.hint')}
          value={step.config.maxSizeMb ?? '100'}
          onChange={(v) => onChange({ ...step.config, maxSizeMb: v === '' ? '' : String(v) })}
          rightSection={<Text component="span" fz="xs" c="var(--text-muted)">{t('flow.skill.file_download.maxSizeMb.unit')}</Text>}
          rightSectionWidth={36}
          hideControls
          size="sm"
          min={0}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
      </FieldPair>
      <Text fz="xs" c="dimmed">{t('flow.skill.file_download.hint')}</Text>
    </Stack>
  );
};
