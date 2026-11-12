import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

function todayCompact(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/** What the runner reads when the field is blank (`search.ts`). */
const SEARCH_DEFAULT_LIMIT = '10';

export const SearchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const query = step.config.query ?? '';
  const limit = step.config.limit ?? SEARCH_DEFAULT_LIMIT;

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.search.query')}
        placeholder={fillTemplate(t('flow.skill.search.query.placeholder'), { date: todayCompact() })}
        value={query}
        onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
        size="sm"
      />

      <AppNumberInput
        label={t('flow.skill.search.limit')}
        // Blank runs with the default, so the blank field says what that default is.
        placeholder={SEARCH_DEFAULT_LIMIT}
        suffix={` ${t('flow.skill.search.limit.unit')}`}
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
        {fillTemplate(t('flow.skill.search.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
