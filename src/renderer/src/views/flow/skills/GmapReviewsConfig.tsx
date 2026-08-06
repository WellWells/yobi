import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

const SORT_OPTIONS = ['mixed', 'relevant', 'newest', 'highest', 'lowest'] as const;

export const GmapReviewsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const sort = step.config.sort ?? 'mixed';
  const count = step.config.count ?? '100';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.gmap_reviews.url')}
        placeholder="https://maps.app.goo.gl/…"
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
      />

      <SelectDropdown
        label={t('flow.skill.gmap_reviews.sort')}
        value={SORT_OPTIONS.includes(sort as typeof SORT_OPTIONS[number]) ? sort : 'mixed'}
        onChange={(v) => onChange({ ...step.config, sort: v || 'mixed' })}
        options={SORT_OPTIONS.map((value) => ({ value, label: t(`flow.skill.gmap_reviews.sort.${value}`) }))}
        size="sm"
      />

      <AppNumberInput
        label={t('flow.skill.gmap_reviews.count')}
        value={count}
        onChange={(v) => onChange({ ...step.config, count: v === '' ? '' : String(v) })}
        size="sm"
        min={10}
        max={300}
        step={10}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.gmap_reviews.outputHint').replaceAll('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
