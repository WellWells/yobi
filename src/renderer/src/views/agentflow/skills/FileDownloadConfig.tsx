import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { isValidUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';

export const FileDownloadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = url.trim() !== '' && !isValidUrlOrVar(url);
  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.file_download.url')}
        placeholder={t('agentflow.skill.file_download.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.file_download.url.error') : undefined}
      />
      <AppTextInput
        label={t('agentflow.skill.file_download.filename')}
        placeholder={t('agentflow.skill.file_download.filename.placeholder')}
        value={step.config.filename ?? ''}
        onChange={(e) => onChange({ ...step.config, filename: e.currentTarget.value })}
        size="sm"
      />
      <AppTextInput
        label={t('agentflow.skill.file_download.folder')}
        placeholder={t('agentflow.skill.file_download.folder.placeholder')}
        value={step.config.folder ?? ''}
        onChange={(e) => onChange({ ...step.config, folder: e.currentTarget.value })}
        size="sm"
      />
      <AppNumberInput
        label={t('agentflow.skill.file_download.maxSizeMb')}
        value={step.config.maxSizeMb ?? '100'}
        onChange={(v) => onChange({ ...step.config, maxSizeMb: v === '' ? '' : String(v) })}
        size="sm"
        min={0}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />
      <Text fz="xs" c="dimmed">{t('agentflow.skill.file_download.hint')}</Text>
    </Stack>
  );
};
