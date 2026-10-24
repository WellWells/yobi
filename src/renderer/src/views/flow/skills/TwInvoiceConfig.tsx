import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillConfigProps } from './types';

/**
 * The receipt-lottery step: numbers to check (blank = just the winning numbers) and which
 * period. Both are free text so a `{{variable}}` from an earlier step fits either.
 */
export const TwInvoiceConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <AppTextarea
      label={t('flow.skill.tw_invoice.numbers')}
      placeholder={t('flow.skill.tw_invoice.numbers.placeholder')}
      value={step.config.numbers ?? ''}
      onChange={(e) => onChange({ ...step.config, numbers: e.currentTarget.value })}
      minRows={2}
      autosize
      size="sm"
    />
    <AppTextInput
      label={t('flow.skill.tw_invoice.period')}
      placeholder={t('flow.skill.tw_invoice.period.placeholder')}
      value={step.config.period ?? ''}
      onChange={(e) => onChange({ ...step.config, period: e.currentTarget.value })}
      size="sm"
    />
    <Text fz="xs" c="dimmed">
      {fillTemplate(t('flow.skill.tw_invoice.outputHint'), {
        text: `{{${step.outputKey}.text}}`,
        won: `{{${step.outputKey}.won}}`,
      })}
    </Text>
  </Stack>
);
