import React from 'react';
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowRightLeft } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { badCurrencyCode, badForexAmount, historyRefusal, refusalText, sameCurrency } from './lookupChecks';
import { marketPeriodPresets } from './StockConfig';
import { QuickValueButtons } from './QuickValueButtons';
import type { SkillConfigProps } from './types';

/** The executor clamps `precision` to 0-12 (`clampIntField`). */
const MAX_PRECISION = 12;

/**
 * The forex step: a currency pair (always side by side, with a swap), an optional amount, an
 * optional history window, and the decimals last since they only shape the output.
 */
export const ForexConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const base = step.config.base ?? '';
  const target = step.config.target ?? '';
  const amount = step.config.amount ?? '';
  const period = step.config.period ?? '';
  const codeError = t('flow.skill.forex.code.error');
  const swapLabel = t('flow.skill.forex.swap');
  const refusal = historyRefusal(step.config);

  return (
    <Stack gap="xs">
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <AppTextInput
          style={{ flex: 1 }}
          label={t('flow.skill.forex.base')}
          placeholder="USD"
          value={base}
          onChange={(e) => onChange({ ...step.config, base: e.currentTarget.value })}
          size="sm"
          mono
          error={badCurrencyCode(base) ? codeError : undefined}
        />
        <Tooltip label={swapLabel}>
          <ActionIcon
            variant="subtle"
            color="gray"
            mt={26}
            aria-label={swapLabel}
            onClick={() => onChange({ ...step.config, base: target, target: base })}
          >
            <ArrowRightLeft size={14} />
          </ActionIcon>
        </Tooltip>
        <AppTextInput
          style={{ flex: 1 }}
          label={t('flow.skill.forex.target')}
          placeholder="TWD"
          value={target}
          onChange={(e) => onChange({ ...step.config, target: e.currentTarget.value })}
          size="sm"
          mono
          error={badCurrencyCode(target) ? codeError : undefined}
        />
      </Group>
      {sameCurrency(base || 'USD', target) && (
        <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.skill.forex.sameCurrency')}</Text>
      )}
      <AppTextInput
        label={t('flow.skill.forex.amount')}
        placeholder={t('flow.skill.forex.amount.placeholder')}
        value={amount}
        onChange={(e) => onChange({ ...step.config, amount: e.currentTarget.value })}
        size="sm"
        rightSection={<Text fz="xs" ff="monospace" c="var(--text-muted)">{(base || 'USD').toUpperCase().slice(0, 3)}</Text>}
        error={badForexAmount(amount) ? t('flow.skill.forex.amount.error') : undefined}
      />
      <Group grow gap="xs" align="flex-start">
        <AppTextInput
          label={t('flow.skill.forex.period')}
          placeholder={t('flow.skill.forex.period.placeholder')}
          value={period}
          onChange={(e) => onChange({ ...step.config, period: e.currentTarget.value })}
          size="sm"
          error={refusalText(refusal, 'period', t)}
        />
        <AppTextInput
          label={t('flow.skill.forex.date')}
          placeholder={t('flow.skill.forex.date.placeholder')}
          value={step.config.date ?? ''}
          onChange={(e) => onChange({ ...step.config, date: e.currentTarget.value })}
          size="sm"
          error={refusalText(refusal, 'date', t)}
        />
      </Group>
      <QuickValueButtons
        label={t('flow.skill.forex.period')}
        values={marketPeriodPresets(t)}
        current={period}
        onPick={(value) => onChange({ ...step.config, period: value })}
      />
      <AppNumberInput
        label={t('flow.skill.forex.precision')}
        value={step.config.precision ?? '4'}
        onChange={(v) => onChange({ ...step.config, precision: v === '' ? '' : String(v) })}
        size="sm"
        w={160}
        min={0}
        max={MAX_PRECISION}
        clampBehavior="strict"
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.forex.source')}</Text>
    </Stack>
  );
};
