import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { XSignInNotice } from './XSignInNotice';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { X_TRENDS_MAX_ITEMS } from '../../../../../shared/flowFeedCaps';

export const XTrendsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const maxItems = step.config.maxItems ?? '20';
  const postsPerTrend = step.config.postsPerTrend ?? '5';

  return (
    <Stack gap="xs">
      <XSignInNotice limit="trends" t={t} />

      <AppNumberInput
        label={t('flow.skill.x_trends.maxItems')}
        description={fillTemplate(t('flow.skill.x_trends.maxItems.desc'), { max: String(X_TRENDS_MAX_ITEMS) })}
        value={maxItems}
        onChange={(v) => onChange({ ...step.config, maxItems: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        max={X_TRENDS_MAX_ITEMS}
        step={5}
        allowDecimal={false}
        allowNegative={false}
      />

      <AppNumberInput
        label={t('flow.skill.x_trends.postsPerTrend')}
        description={t('flow.skill.x_trends.postsPerTrend.desc')}
        value={postsPerTrend}
        onChange={(v) => onChange({ ...step.config, postsPerTrend: v === '' ? '' : String(v) })}
        size="sm"
        min={0}
        max={20}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.x_trends.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
