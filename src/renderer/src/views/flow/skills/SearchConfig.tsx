import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import type { SkillConfigProps } from './types';

function todayCompact(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export const SearchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const query = step.config.query ?? '';
  const limit = step.config.limit ?? '10';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.search.query')}
        placeholder={t('flow.skill.search.query.placeholder').replace('{{date}}', todayCompact())}
        value={query}
        onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
        size="sm"
      />

      <AppNumberInput
        label={t('flow.skill.search.limit')}
        value={limit}
        onChange={(v) => onChange({ ...step.config, limit: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        max={10}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.search.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
