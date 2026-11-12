import React from 'react';
import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { LineChatPicker } from '../../../components/LineChatPicker';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { lineReadApi } from '../../../api/electronApi';
import { LINE_RANGE_PRESETS } from '../../../../../shared/lineRange';
import { SeenRecordRow, useSeenRecord } from './SeenRecordRow';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A card at least this wide puts the keyword and the message limit side by side. */
const SIDE_BY_SIDE_FROM = '640px';

/**
 * A literal date is checked here so a typo is caught while editing; a {{variable}} can only be
 * judged at run time, where resolveLineRange() aborts the run rather than reading all of history.
 */
function dateError(value: string, invalid: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('{{')) return undefined;
  return DATE_ONLY.test(trimmed) ? undefined : invalid;
}

/**
 * What the run would refuse about a custom range, said on the field while editing: both ends
 * blank, or an end before the start. Same words as the run's errors (`resolveLineRange`).
 */
export function customRangeErrors(
  since: string,
  until: string,
  t: (key: string) => string,
): { since?: string; until?: string } {
  const start = since.trim();
  const end = until.trim();
  if (!start && !end) return { since: t('flow.error.lineRangeEmpty') };
  if (DATE_ONLY.test(start) && DATE_ONLY.test(end) && start > end) {
    return { until: fillTemplate(t('flow.error.lineRangeReversed'), { since: start, until: end }) };
  }
  return {};
}

export const LineReadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowVariables }) => {
  const range = step.config.range ?? 'all';
  const invalid = t('flow.skill.line_read.date.invalid');
  const since = step.config.since ?? '';
  const until = step.config.until ?? '';
  const sinceLastRun = step.config.sinceLastRun === 'true';
  const chosen = (step.config.chat ?? '').split(',').some((id) => id.trim());
  const rangeErrors = range === 'custom' ? customRangeErrors(since, until, t) : {};
  const [hasMark, clearMark] = useSeenRecord(step.id, lineReadApi);

  return (
    <Stack gap="xs">
      <LineChatPicker
        value={step.config.chat ?? ''}
        onChange={(chat) => onChange({ ...step.config, chat })}
        label={t('flow.skill.line_read.chat')}
        hint={t('flow.skill.line_read.chat.hint')}
        variables={flowVariables}
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
            value={since}
            onChange={(e) => onChange({ ...step.config, since: e.currentTarget.value })}
            error={dateError(since, invalid) ?? rangeErrors.since}
            size="sm"
          />
          <AppTextInput
            label={t('flow.skill.line_read.until')}
            placeholder="2026-09-05"
            value={until}
            onChange={(e) => onChange({ ...step.config, until: e.currentTarget.value })}
            error={dateError(until, invalid) ?? rangeErrors.until}
            size="sm"
          />
        </Group>
      )}

      <ToggleSwitch
        label={t('flow.skill.line_read.sinceLastRun')}
        checked={sinceLastRun}
        onChange={(e) => onChange({ ...step.config, sinceLastRun: e.currentTarget.checked ? 'true' : 'false' })}
        size="sm"
      />
      {sinceLastRun && (
        <SeenRecordRow
          has={hasMark}
          onClear={() => void clearMark()}
          label={t('flow.skill.line_read.seen.kept')}
          clearLabel={t('flow.skill.line_read.seen.clear')}
          clearHint={t('flow.skill.line_read.seen.clearHint')}
        />
      )}

      <SimpleGrid type="container" cols={{ base: 1, [SIDE_BY_SIDE_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
        <AppTextInput
          label={t('flow.skill.line_read.query')}
          placeholder={t('flow.skill.line_read.query.placeholder')}
          value={step.config.query ?? ''}
          onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
          size="sm"
        />
        <AppNumberInput
          label={t(chosen ? 'flow.skill.line_read.limit' : 'flow.skill.line_read.limit.total')}
          value={step.config.limit ?? '200'}
          onChange={(v) => onChange({ ...step.config, limit: v === '' ? '' : String(v) })}
          size="sm"
          min={1}
          max={5000}
          step={50}
          allowDecimal={false}
          allowNegative={false}
        />
      </SimpleGrid>

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.line_read.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
