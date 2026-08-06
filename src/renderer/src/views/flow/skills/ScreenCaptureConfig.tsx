import React from 'react';
import { Stack, Text } from '@mantine/core';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { PathInput } from '../../../components/PathInput';
import type { SkillConfigProps } from './types';

export const ScreenCaptureConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <SelectDropdown
      label={t('flow.skill.capture.format')}
      options={[
        { value: 'png', label: 'PNG' },
        { value: 'jpg', label: 'JPG' },
      ]}
      value={step.config.format ?? 'png'}
      onChange={(value) => onChange({ ...step.config, format: value })}
      size="sm"
    />
    <PathInput
      label={t('flow.skill.capture.output')}
      placeholder={t('flow.skill.capture.output.placeholder')}
      browseLabel={t('flow.path.browse')}
      mode="folder"
      value={step.config.output ?? ''}
      onChange={(output) => onChange({ ...step.config, output })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('flow.skill.capture.output.hint')}</Text>
  </Stack>
);
