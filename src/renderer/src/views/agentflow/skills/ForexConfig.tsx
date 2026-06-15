import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import type { SkillConfigProps } from './types';

export const ForexConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <Group grow gap="xs">
      <AppTextInput
        label={t('agentflow.skill.forex.base')}
        placeholder="USD"
        value={step.config.base ?? ''}
        onChange={(e) => onChange({ ...step.config, base: e.currentTarget.value })}
        size="sm"
        mono
      />
      <AppTextInput
        label={t('agentflow.skill.forex.target')}
        placeholder="TWD"
        value={step.config.target ?? ''}
        onChange={(e) => onChange({ ...step.config, target: e.currentTarget.value })}
        size="sm"
        mono
      />
    </Group>
    <Group grow gap="xs">
      <AppTextInput
        label={t('agentflow.skill.forex.amount')}
        placeholder={t('agentflow.skill.forex.amount.placeholder')}
        value={step.config.amount ?? ''}
        onChange={(e) => onChange({ ...step.config, amount: e.currentTarget.value })}
        size="sm"
      />
      <AppNumberInput
        label={t('agentflow.skill.forex.precision')}
        value={step.config.precision ?? '4'}
        onChange={(v) => onChange({ ...step.config, precision: v === '' ? '' : String(v) })}
        size="sm"
        min={0}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />
    </Group>
    <Text fz="xs" c="dimmed">{t('agentflow.skill.forex.source')}</Text>
  </Stack>
);
