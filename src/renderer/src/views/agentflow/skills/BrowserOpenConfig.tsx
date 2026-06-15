import React from 'react';
import { Stack, Text } from '@mantine/core';
import { Eye } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import type { SkillConfigProps } from './types';

export const BrowserOpenConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.browser_open.url')}
      placeholder={t('agentflow.skill.browser_open.url.placeholder')}
      value={step.config.url ?? ''}
      onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
      size="sm"
    />

    <SettingRow
      icon={<Eye size={13} />}
      label={t('agentflow.skill.browser_open.show')}
      hint={t('agentflow.skill.browser_open.show.hint')}
      control={
        <ToggleSwitch
          checked={step.config.show === 'true'}
          onChange={(e) => onChange({ ...step.config, show: e.currentTarget.checked ? 'true' : 'false' })}
        />
      }
    />

    <Text fz="xs" c="dimmed">
      {t('agentflow.skill.browser_open.hint').split('{{outputKey}}').join(`{{${step.outputKey}}}`)}
    </Text>
  </Stack>
);
