import React from 'react';
import { Input, Stack, Text } from '@mantine/core';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { PathInput } from '../../../components/PathInput';
import type { SkillConfigProps } from './types';

export const ScreenCaptureConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    {/* The runner captures the primary display only; there is nothing to pick, so it is said, not asked. */}
    <Text fz="xs" c="var(--text-muted)" data-capture-scope="">{t('flow.skill.capture.scope')}</Text>
    <Input.Wrapper label={t('flow.skill.capture.format')}>
      <AppSegmentedControl
        value={step.config.format === 'jpg' ? 'jpg' : 'png'}
        onChange={(value) => onChange({ ...step.config, format: value })}
        options={[
          { value: 'png', label: 'PNG' },
          { value: 'jpg', label: 'JPG' },
        ]}
        size="sm"
      />
    </Input.Wrapper>
    <PathInput
      label={t('flow.skill.capture.output')}
      placeholder={t('flow.skill.capture.output.placeholder')}
      browseLabel={t('flow.path.browse')}
      mode="folder"
      value={step.config.output ?? ''}
      onChange={(output) => onChange({ ...step.config, output })}
      size="sm"
    />
    <Text fz="xs" c="var(--text-muted)">{t('flow.skill.capture.output.hint')}</Text>
  </Stack>
);
