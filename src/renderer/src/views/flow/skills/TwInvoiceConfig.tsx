import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { parseTicketNumbers, ticketNumbersRefusal } from '../../../../../shared/invoiceNumbers';
import type { SkillConfigProps } from './types';

/**
 * The receipt-lottery step: numbers to check (blank = just the winning numbers) and which
 * period. Both are free text so a `{{variable}}` from an earlier step fits either. The numbers are
 * read as the run reads them, so a phone number or a date is flagged before the run refuses it.
 */
export const TwInvoiceConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const raw = step.config.numbers ?? '';
  const refusal = ticketNumbersRefusal(raw);
  const checking = raw.trim() !== '';
  const readCount = checking && !refusal && !raw.includes('{{') ? parseTicketNumbers(raw).numbers.length : 0;

  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.tw_invoice.numbers')}
        placeholder={t('flow.skill.tw_invoice.numbers.placeholder')}
        value={raw}
        onChange={(e) => onChange({ ...step.config, numbers: e.currentTarget.value })}
        error={refusal ? fillTemplate(t('flow.error.invoiceNumbers'), { value: refusal }) : undefined}
        description={readCount > 0 ? fillTemplate(t('flow.skill.tw_invoice.numbers.read'), { count: String(readCount) }) : undefined}
        minRows={2}
        maxRows={10}
        autosize
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.tw_invoice.period')}
        placeholder={t(checking ? 'flow.skill.tw_invoice.period.placeholder' : 'flow.skill.tw_invoice.period.latestPlaceholder')}
        value={step.config.period ?? ''}
        onChange={(e) => onChange({ ...step.config, period: e.currentTarget.value })}
        size="sm"
      />
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.tw_invoice.outputHint'), {
          text: `{{${step.outputKey}.text}}`,
          won: `{{${step.outputKey}.won}}`,
        })}
      </Text>
    </Stack>
  );
};
