import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Fingerprint } from 'lucide-react';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import type { SkillConfigProps } from './types';

export const RandomConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const count = Number.parseInt((step.config.count ?? '1').trim(), 10);
  const isMulti = Number.isFinite(count) && count > 1;
  const hint = isMulti
    ? t('agentflow.skill.random.hint.multi')
    : t('agentflow.skill.random.hint.single').replace('{{outputKey}}', `{{${step.outputKey}}}`);

  return (
    <Stack gap="xs">
      <Group grow gap="xs">
        <AppNumberInput
          label={t('agentflow.skill.random.min')}
          value={step.config.min ?? '1'}
          onChange={(v) => onChange({ ...step.config, min: v === '' ? '' : String(v) })}
          size="sm"
          step={1}
          allowDecimal={false}
        />
        <AppNumberInput
          label={t('agentflow.skill.random.max')}
          value={step.config.max ?? '100'}
          onChange={(v) => onChange({ ...step.config, max: v === '' ? '' : String(v) })}
          size="sm"
          step={1}
          allowDecimal={false}
        />
        <AppNumberInput
          label={t('agentflow.skill.random.count')}
          value={step.config.count ?? '1'}
          onChange={(v) => onChange({ ...step.config, count: v === '' ? '' : String(v) })}
          size="sm"
          min={1}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
      </Group>
      <SettingRow
        icon={<Fingerprint size={13} />}
        label={t('agentflow.skill.random.unique')}
        hint={t('agentflow.skill.random.unique.hint')}
        control={
          <ToggleSwitch
            checked={step.config.unique === 'true'}
            onChange={(e) => onChange({ ...step.config, unique: e.currentTarget.checked ? 'true' : 'false' })}
            aria-label={t('agentflow.skill.random.unique')}
          />
        }
      />
      <Text fz="xs" c="dimmed">{hint}</Text>
    </Stack>
  );
};
