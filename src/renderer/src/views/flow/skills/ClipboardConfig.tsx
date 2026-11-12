import React from 'react';
import { Input, Stack } from '@mantine/core';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { AppTextarea } from '../../../components/AppTextarea';
import type { SkillConfigProps } from './types';

export const ClipboardConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <Input.Wrapper label={t('flow.skill.clipboard.action')}>
      <AppSegmentedControl
        value={step.config.action === 'write' ? 'write' : 'read'}
        options={[
          { value: 'read', label: t('flow.skill.clipboard.read') },
          { value: 'write', label: t('flow.skill.clipboard.write') },
        ]}
        onChange={(value) => onChange({ ...step.config, action: value })}
        size="sm"
      />
    </Input.Wrapper>
    {step.config.action === 'write' && (
      <AppTextarea
        label={t('flow.skill.clipboard.text')}
        value={step.config.text ?? ''}
        onChange={(e) => onChange({ ...step.config, text: e.currentTarget.value })}
        minRows={2}
        autosize
        size="sm"
      />
    )}
  </Stack>
);
