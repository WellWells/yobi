import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

export const StockConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('flow.skill.stock.symbol')}
      placeholder={t('flow.skill.stock.symbol.placeholder')}
      value={step.config.symbol ?? ''}
      onChange={(e) => onChange({ ...step.config, symbol: e.currentTarget.value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('flow.skill.stock.symbol.hint')}</Text>
    <Group grow gap="xs">
      <AppTextInput
        label={t('flow.skill.stock.period')}
        placeholder={t('flow.skill.stock.period.placeholder')}
        value={step.config.period ?? ''}
        onChange={(e) => onChange({ ...step.config, period: e.currentTarget.value })}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.stock.date')}
        placeholder={t('flow.skill.stock.date.placeholder')}
        value={step.config.date ?? ''}
        onChange={(e) => onChange({ ...step.config, date: e.currentTarget.value })}
        size="sm"
      />
    </Group>
    <Text fz="xs" c="dimmed">{t('flow.skill.stock.period.hint')}</Text>
    <Text fz="xs" c="dimmed">{t('flow.skill.stock.source')}</Text>
  </Stack>
);
