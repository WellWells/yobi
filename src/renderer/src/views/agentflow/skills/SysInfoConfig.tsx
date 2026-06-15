import React from 'react';
import { Stack, Text } from '@mantine/core';
import { Cpu, Globe } from 'lucide-react';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import type { SkillConfigProps } from './types';

export const SysInfoConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <SelectDropdown
      label={t('agentflow.skill.sysinfo.format')}
      options={[
        { value: 'text', label: t('agentflow.skill.sysinfo.format.text') },
        { value: 'json', label: t('agentflow.skill.sysinfo.format.json') },
      ]}
      value={step.config.format ?? 'text'}
      onChange={(value) => onChange({ ...step.config, format: value })}
      size="sm"
    />

    <SettingRow
      icon={<Cpu size={13} />}
      label={t('agentflow.skill.sysinfo.includeGpu')}
      control={(
        <ToggleSwitch
          checked={step.config.includeGpu !== 'false'}
          onChange={(e) => onChange({ ...step.config, includeGpu: e.currentTarget.checked ? 'true' : 'false' })}
        />
      )}
    />

    <SettingRow
      icon={<Globe size={13} />}
      label={t('agentflow.skill.sysinfo.includePublicIp')}
      hint={t('agentflow.skill.sysinfo.includePublicIp.hint')}
      control={(
        <ToggleSwitch
          checked={step.config.includePublicIp === 'true'}
          onChange={(e) => onChange({ ...step.config, includePublicIp: e.currentTarget.checked ? 'true' : 'false' })}
        />
      )}
    />

    <Text fz="xs" c="dimmed">
      {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
    </Text>
  </Stack>
);
