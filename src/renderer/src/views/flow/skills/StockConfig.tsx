import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { splitSymbols } from '../../../../../shared/flowListTerms';
import { QuickValueButtons, type QuickValue } from './QuickValueButtons';
import { historyRefusal, refusalText } from './lookupChecks';
import type { SkillConfigProps } from './types';

/** The history windows people ask for most, as the codes the market step reads. */
export function marketPeriodPresets(t: (key: string) => string): QuickValue[] {
  return [
    { value: '5d', label: fillTemplate(t('flow.summary.period.d'), { count: '5' }) },
    { value: '1mo', label: fillTemplate(t('flow.summary.period.mo'), { count: '1' }) },
    { value: '6mo', label: fillTemplate(t('flow.summary.period.mo'), { count: '6' }) },
    { value: '1y', label: fillTemplate(t('flow.summary.period.y'), { count: '1' }) },
    { value: 'ytd', label: t('flow.summary.period.ytd') },
  ];
}

export const StockConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const symbol = step.config.symbol ?? '';
  const period = step.config.period ?? '';
  const several = splitSymbols(symbol).length > 1;
  const refusal = historyRefusal(step.config);

  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.stock.symbol')}
        placeholder={t('flow.skill.stock.symbol.placeholder')}
        value={symbol}
        onChange={(e) => onChange({ ...step.config, symbol: e.currentTarget.value })}
        minRows={1}
        maxRows={8}
        autosize
        mono
        size="sm"
      />
      <Text fz="xs" c="var(--text-muted)">
        {t(several ? 'flow.skill.stock.symbol.severalHint' : 'flow.skill.stock.symbol.hint')}
      </Text>
      <Group grow gap="xs" align="flex-start">
        <AppTextInput
          label={t('flow.skill.stock.period')}
          placeholder={t('flow.skill.stock.period.placeholder')}
          value={period}
          onChange={(e) => onChange({ ...step.config, period: e.currentTarget.value })}
          size="sm"
          error={refusalText(refusal, 'period', t)}
        />
        <AppTextInput
          label={t('flow.skill.stock.date')}
          placeholder={t('flow.skill.stock.date.placeholder')}
          value={step.config.date ?? ''}
          onChange={(e) => onChange({ ...step.config, date: e.currentTarget.value })}
          size="sm"
          error={refusalText(refusal, 'date', t)}
        />
      </Group>
      <QuickValueButtons
        label={t('flow.skill.stock.period')}
        values={marketPeriodPresets(t)}
        current={period}
        onPick={(value) => onChange({ ...step.config, period: value })}
      />
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.stock.period.hint')}</Text>
    </Stack>
  );
};
