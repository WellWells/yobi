import React, { useId } from 'react';
import { Input, SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { LlmOption } from './LlmConfigHelp';
import { PAIR_FIELDS_FROM } from './fieldLayout';
import { firstUnreadableUrlLine } from './validation';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

const DEPTH_OPTIONS = ['quick', 'standard', 'deep'] as const;
type Depth = typeof DEPTH_OPTIONS[number];

export const ResearchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const query = step.config.query ?? '';
  const urls = step.config.urls ?? '';
  const rawDepth = step.config.depth ?? 'standard';
  const depth: Depth = DEPTH_OPTIONS.includes(rawDepth as Depth) ? rawDepth as Depth : 'standard';
  const sources = step.config.sources ?? '';
  const depthLabelId = useId();
  // The runner reads given pages whatever the depth, and a deep run picks its own page count; both
  // fields keep their values for when that changes back.
  const givenUrls = urls.trim() !== '';
  const deep = depth === 'deep';
  const badLine = givenUrls ? firstUnreadableUrlLine(urls) : null;
  const out = (sub?: string): string => `{{${step.outputKey}${sub ? `.${sub}` : ''}}}`;

  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.research.query')}
        placeholder={t('flow.skill.research.query.placeholder')}
        value={query}
        onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
        // Given pages without a question do nothing at run time.
        error={givenUrls && !query.trim() ? t('flow.skill.research.query.requiredWithUrls') : undefined}
        withAsterisk
        autosize
        minRows={1}
        maxRows={4}
        size="sm"
      />

      <AppTextarea
        label={t('flow.skill.research.urls')}
        description={t('flow.skill.research.urls.hint')}
        placeholder={t('flow.skill.research.urls.placeholder')}
        value={urls}
        onChange={(e) => onChange({ ...step.config, urls: e.currentTarget.value })}
        error={badLine === null ? undefined : fillTemplate(t('flow.skill.research.urls.badLine'), { line: String(badLine) })}
        size="sm"
        autosize
        minRows={2}
        maxRows={5}
      />

      <SimpleGrid type="container" cols={{ base: 1, [PAIR_FIELDS_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
        <Stack gap={4}>
          <Input.Label id={depthLabelId}>{t('flow.skill.research.depth')}</Input.Label>
          <AppSegmentedControl
            aria-labelledby={depthLabelId}
            value={depth}
            onChange={(value) => onChange({ ...step.config, depth: value })}
            options={DEPTH_OPTIONS.map((value) => ({ value, label: t(`flow.skill.research.depth.${value}`) }))}
            disabled={givenUrls}
            size="sm"
          />
          <Text fz="xs" c="var(--text-muted)" data-research-depth-hint="">
            {givenUrls ? t('flow.skill.research.depth.givenUrls') : t(`flow.skill.research.depth.${depth}.hint`)}
          </Text>
        </Stack>

        <AppNumberInput
          label={t('flow.skill.research.sources')}
          description={deep ? t('flow.skill.research.sources.deep') : t('flow.skill.research.sources.hint')}
          placeholder={t('flow.skill.research.sources.placeholder')}
          value={sources}
          onChange={(v) => onChange({ ...step.config, sources: v === '' ? '' : String(v) })}
          disabled={deep}
          size="sm"
          min={1}
          max={8}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
      </SimpleGrid>

      <LlmOption
        label={t('flow.skill.research.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.research.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        t={t}
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.research.outputHint'), { answer: out(), sources: out('sources'), count: out('count') })}
      </Text>
    </Stack>
  );
};
