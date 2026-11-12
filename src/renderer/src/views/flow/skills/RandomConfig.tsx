import React from 'react';
import { SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { StatusLine } from '../../../components/StatusLine';
import type { SkillConfigProps } from './types';
import { PAIR_FIELDS_FROM } from './fieldLayout';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import {
  RANDOM_DEFAULT_COUNT, RANDOM_DEFAULT_MAX, RANDOM_DEFAULT_MIN, RANDOM_MAX_COUNT, randomFormFacts, readRandomField,
  type RandomFieldIssue,
} from '../../../../../shared/flowRandom';

// Whole keys, so the i18n check sees them.
const ISSUE_KEY: Record<RandomFieldIssue, string> = {
  format: 'flow.skill.random.error.format',
  unsafe: 'flow.skill.random.error.unsafe',
  countRange: 'flow.skill.random.error.countRange',
};

/**
 * A whole number or one `{{variable}}`, as the runner reads min, max and count: a number input
 * would drop the variable an AI-built or imported step holds. ↑/↓ still step a number.
 */
const IntegerOrVariableInput: React.FC<{
  label: string;
  value: string;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, error, onChange }) => (
  <AppTextInput
    label={label}
    value={value}
    placeholder={placeholder}
    error={error}
    numeric
    inputMode="numeric"
    size="sm"
    onChange={(e) => onChange(e.currentTarget.value)}
    onKeyDown={(e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const field = readRandomField(value || placeholder);
      if (field.kind !== 'number') return;
      e.preventDefault();
      onChange(String(field.value + (e.key === 'ArrowUp' ? 1 : -1)));
    }}
  />
);

export const RandomConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const facts = randomFormFacts(step.config);
  const isMulti = (facts.countValue ?? 0) > 1 || readRandomField(step.config.count).kind === 'variable';
  const hint = isMulti
    ? t('flow.skill.random.hint.multi')
    : fillTemplate(t('flow.skill.random.hint.single'), { outputKey: `{{${step.outputKey}}}` });
  const issue = (key?: RandomFieldIssue): string | undefined => (key ? t(ISSUE_KEY[key]) : undefined);
  const set = (field: 'min' | 'max' | 'count') => (value: string): void => onChange({ ...step.config, [field]: value });

  return (
    <Stack gap="xs">
      {/* min and max read as one range, so they share a row even in a narrow card. */}
      <SimpleGrid type="container" cols={{ base: 2, [PAIR_FIELDS_FROM]: 3 }} spacing="xs" verticalSpacing="xs">
        <IntegerOrVariableInput
          label={t('flow.skill.random.min')}
          value={step.config.min ?? ''}
          placeholder={String(RANDOM_DEFAULT_MIN)}
          error={issue(facts.min)}
          onChange={set('min')}
        />
        <IntegerOrVariableInput
          label={t('flow.skill.random.max')}
          value={step.config.max ?? ''}
          placeholder={String(RANDOM_DEFAULT_MAX)}
          error={issue(facts.max)}
          onChange={set('max')}
        />
        <IntegerOrVariableInput
          label={t('flow.skill.random.count')}
          value={step.config.count ?? ''}
          placeholder={String(RANDOM_DEFAULT_COUNT)}
          error={issue(facts.count)}
          onChange={set('count')}
        />
      </SimpleGrid>
      {/* Hidden at one number, where it does nothing; the value stays for when the count goes up. */}
      {isMulti && (
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
      )}
      {facts.swapped && <Text fz="xs" c="var(--text-muted)">{t('flow.skill.random.swapped')}</Text>}
      {facts.uniqueCap !== undefined && (
        <StatusLine tone="warning">{fillTemplate(t('flow.skill.random.uniqueCapped'), { size: String(facts.uniqueCap) })}</StatusLine>
      )}
      {facts.countCapped && (
        <StatusLine tone="warning">{fillTemplate(t('flow.skill.random.countCapped'), { max: RANDOM_MAX_COUNT.toLocaleString() })}</StatusLine>
      )}
      <Text fz="xs" c="var(--text-muted)">{hint}</Text>
    </Stack>
  );
};
