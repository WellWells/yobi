import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { Sliders } from 'lucide-react';
import type { SkillConfigProps } from './types';

export const LoopConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const input = step.config.input ?? '';
  const loopVar = step.config.loopVar ?? 'item';
  const limitIterations = step.config.limitIterations !== 'false';
  const maxIterationsVal = step.config.maxIterations ? parseInt(step.config.maxIterations, 10) : 5;

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.loop.input')}
        placeholder={t('agentflow.skill.loop.input.placeholder')}
        value={input}
        onChange={(e) => onChange({ ...step.config, input: e.currentTarget.value })}
        size="sm"
      />

      <AppTextInput
        label={t('agentflow.skill.loop.loopVar')}
        placeholder={t('agentflow.skill.loop.loopVar.placeholder')}
        value={loopVar}
        onChange={(e) => onChange({ ...step.config, loopVar: e.currentTarget.value })}
        size="sm"
      />

      <SettingRow
        icon={<Sliders size={13} />}
        label={t('agentflow.skill.loop.limitIterations')}
        control={
          <ToggleSwitch
            checked={limitIterations}
            onChange={(checked) => onChange({ ...step.config, limitIterations: checked ? 'true' : 'false' })}
          />
        }
      />

      {limitIterations && (
        <AppNumberInput
          label={t('agentflow.skill.loop.maxIterations')}
          placeholder="5"
          value={maxIterationsVal}
          onChange={(val) => onChange({ ...step.config, maxIterations: String(val ?? 5) })}
          min={1}
          size="sm"
        />
      )}

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.loop.hint').replace('{{var}}', loopVar ? `{{${loopVar}.title}}` : '{{item.title}}')}
      </Text>
    </Stack>
  );
};
