import React from 'react';
import { Stack, Text } from '@mantine/core';
import { TabPicker } from './TabPicker';
import type { SkillConfigProps } from './types';

export const BrowserCloseConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <TabPicker
      stepId={step.id}
      label={t('flow.skill.browser_close.page')}
      value={step.config.page ?? ''}
      onChange={(page) => onChange({ ...step.config, page })}
      withAll
      t={t}
    />

    <Text fz="xs" c="var(--text-muted)">{t('flow.skill.browser_close.hint')}</Text>
  </Stack>
);
