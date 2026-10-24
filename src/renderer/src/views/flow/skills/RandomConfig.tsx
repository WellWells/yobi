import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

export const RandomConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const count = Number.parseInt((step.config.count ?? '1').trim(), 10);
  const isMulti = Number.isFinite(count) && count > 1;
  const hint = isMulti
    ? t('flow.skill.random.hint.multi')
    : fillTemplate(t('flow.skill.random.hint.single'), { outputKey: `{{${step.outputKey}}}` });

  return (
    <Stack gap="xs">
      <Group grow gap="xs">
        <AppNumberInput
          label={t('flow.skill.random.min')}
          value={step.config.min ?? '1'}
          onChange={(v) => onChange({ ...step.config, min: v === '' ? '' : String(v) })}
          size="sm"
          step={1}
          allowDecimal={false}
        />
        <AppNumberInput
          label={t('flow.skill.random.max')}
          value={step.config.max ?? '100'}
          onChange={(v) => onChange({ ...step.config, max: v === '' ? '' : String(v) })}
          size="sm"
          step={1}
          allowDecimal={false}
        />
        <AppNumberInput
          label={t('flow.skill.random.count')}
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
        label={t('flow.skill.random.unique')}
        hint={t('flow.skill.random.unique.hint')}
        control={
          <ToggleSwitch
            checked={step.config.unique === 'true'}
            onChange={(e) => onChange({ ...step.config, unique: e.currentTarget.checked ? 'true' : 'false' })}
            aria-label={t('flow.skill.random.unique')}
          />
        }
      />
      <Text fz="xs" c="dimmed">{hint}</Text>
    </Stack>
  );
};
