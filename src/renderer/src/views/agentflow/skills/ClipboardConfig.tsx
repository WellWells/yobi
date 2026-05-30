import React from 'react';
import { Stack } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

export const ClipboardConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <SelectDropdown
      label={t('agentflow.skill.clipboard.action')}
      options={[
        { value: 'read', label: t('agentflow.skill.clipboard.read') },
        { value: 'write', label: t('agentflow.skill.clipboard.write') },
      ]}
      value={step.config.action ?? 'read'}
      onChange={(value) => onChange({ ...step.config, action: value })}
      size="sm"
    />
    {step.config.action === 'write' && (
      <AppTextarea
        label={t('agentflow.skill.clipboard.text')}
        value={step.config.text ?? ''}
        onChange={(e) => onChange({ ...step.config, text: e.currentTarget.value })}
        minRows={2}
        autosize
        size="sm"
      />
    )}
  </Stack>
);
