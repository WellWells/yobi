import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { XSignInNotice } from './XSignInNotice';
import type { SkillConfigProps } from './types';

export const XTrendsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const maxItems = step.config.maxItems ?? '20';
  const postsPerTrend = step.config.postsPerTrend ?? '5';

  return (
    <Stack gap="xs">
      <XSignInNotice limit="trends" t={t} />

      <AppNumberInput
        label={t('flow.skill.x_trends.maxItems')}
        value={maxItems}
        onChange={(v) => onChange({ ...step.config, maxItems: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={5}
        allowDecimal={false}
        allowNegative={false}
      />

      <AppNumberInput
        label={t('flow.skill.x_trends.postsPerTrend')}
        value={postsPerTrend}
        onChange={(v) => onChange({ ...step.config, postsPerTrend: v === '' ? '' : String(v) })}
        size="sm"
        min={0}
        max={20}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">{t('flow.skill.x_trends.hint')}</Text>

      <Text fz="xs" c="dimmed">
        {t('flow.skill.x_trends.outputHint').replaceAll('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
