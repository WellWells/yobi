import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import type { SkillConfigProps } from './types';

export const StockConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextInput
      label={t('agentflow.skill.stock.symbol')}
      placeholder={t('agentflow.skill.stock.symbol.placeholder')}
      value={step.config.symbol ?? ''}
      onChange={(e) => onChange({ ...step.config, symbol: e.currentTarget.value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">{t('agentflow.skill.stock.symbol.hint')}</Text>
    <Text fz="xs" c="dimmed">{t('agentflow.skill.stock.source')}</Text>
  </Stack>
);
