import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { LineChatPicker } from '../../../components/LineChatPicker';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { LINE_RANGE_PRESETS } from '../../../../../shared/lineRange';
import type { SkillConfigProps } from './types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A literal date is checked here so a typo is caught while editing; a {{variable}} can only be
 * judged at run time, where resolveLineRange() aborts the run rather than reading all of history.
 */
function dateError(value: string, invalid: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('{{')) return undefined;
  return DATE_ONLY.test(trimmed) ? undefined : invalid;
}

export const LineReadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const range = step.config.range ?? 'all';
  const invalid = t('flow.skill.line_read.date.invalid');

  return (
    <Stack gap="xs">
      <LineChatPicker
        value={step.config.chat ?? ''}
        onChange={(chat) => onChange({ ...step.config, chat })}
        label={t('flow.skill.line_read.chat')}
        hint={t('flow.skill.line_read.chat.hint')}
      />

      <AppNumberInput
        label={t('flow.skill.line_read.limit')}
        value={step.config.limit ?? '200'}
        onChange={(v) => onChange({ ...step.config, limit: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        max={5000}
        step={50}
        allowDecimal={false}
        allowNegative={false}
      />

      <SelectDropdown
        label={t('flow.skill.line_read.range')}
        options={LINE_RANGE_PRESETS.map((preset) => ({
          value: preset,
          label: t(`flow.skill.line_read.range.${preset}`),
        }))}
        value={range}
        onChange={(next) => onChange({ ...step.config, range: next })}
        size="sm"
      />

      {range === 'custom' && (
        <Group gap="xs" grow align="flex-start">
          <AppTextInput
            label={t('flow.skill.line_read.since')}
            placeholder="2026-09-01"
            value={step.config.since ?? ''}
            onChange={(e) => onChange({ ...step.config, since: e.currentTarget.value })}
            error={dateError(step.config.since ?? '', invalid)}
            size="sm"
          />
          <AppTextInput
            label={t('flow.skill.line_read.until')}
            placeholder="2026-09-05"
            value={step.config.until ?? ''}
            onChange={(e) => onChange({ ...step.config, until: e.currentTarget.value })}
            error={dateError(step.config.until ?? '', invalid)}
            size="sm"
          />
        </Group>
      )}

      <AppTextInput
        label={t('flow.skill.line_read.query')}
        placeholder={t('flow.skill.line_read.query.placeholder')}
        value={step.config.query ?? ''}
        onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
        size="sm"
      />

      <ToggleSwitch
        label={t('flow.skill.line_read.sinceLastRun')}
        checked={step.config.sinceLastRun === 'true'}
        onChange={(e) => onChange({ ...step.config, sinceLastRun: e.currentTarget.checked ? 'true' : 'false' })}
        size="sm"
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.line_read.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
