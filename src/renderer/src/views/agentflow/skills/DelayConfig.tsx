import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

const MAX_MS = 3_600_000;
const UNIT_FACTOR: Record<string, number> = { ms: 1, seconds: 1_000, minutes: 60_000 };

export const DelayConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const unit = step.config.delayUnit ?? 'ms';
  const factor = UNIT_FACTOR[unit] ?? 1;
  const ms = Number(step.config.delayMs ?? '1000') || 0;
  const value = step.config.delayValue !== undefined ? (Number(step.config.delayValue) || 0) : ms / factor;
  const maxInUnit = MAX_MS / factor;

  const handleValueChange = (v: number | string) => {
    const num = typeof v === 'number' ? v : 0;
    const clampedMs = Math.min(Math.max(Math.round(num * factor), 0), MAX_MS);
    onChange({ ...step.config, delayValue: String(num), delayUnit: unit, delayMs: String(clampedMs) });
  };

  const handleUnitChange = (nextUnit: string) => {
    const nextValue = ms / (UNIT_FACTOR[nextUnit] ?? 1);
    onChange({ ...step.config, delayUnit: nextUnit, delayValue: String(nextValue) });
  };

  return (
    <Stack gap="xs">
      <Group gap="xs" align="flex-end" grow>
        <AppNumberInput
          label={t('agentflow.skill.delay.value')}
          value={value}
          onChange={handleValueChange}
          min={0}
          max={maxInUnit}
          step={unit === 'ms' ? 100 : 1}
          allowNegative={false}
          size="sm"
        />
        <SelectDropdown
          label={t('agentflow.skill.delay.unit')}
          options={[
            { value: 'ms', label: t('agentflow.skill.delay.unit.ms') },
            { value: 'seconds', label: t('agentflow.skill.delay.unit.seconds') },
            { value: 'minutes', label: t('agentflow.skill.delay.unit.minutes') },
          ]}
          value={unit}
          onChange={handleUnitChange}
          size="sm"
        />
      </Group>
      <Text fz="xs" c="dimmed">{t('agentflow.skill.delay.max')}</Text>
    </Stack>
  );
};
