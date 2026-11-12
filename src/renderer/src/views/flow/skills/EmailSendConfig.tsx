import React, { useId, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { MailAccountField } from './MailAccountField';
import { FieldPair } from './FieldPair';
import { invalidMailRecipients } from './validation';
import type { SkillConfigProps } from './types';
import { FieldLabelRow } from './FieldLabelRow';
import { fillTemplate } from '../../../../../shared/fillTemplate';

export const EmailSendConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, draftButton }) => {
  const bodyId = useId();
  // Checked once the field is left, so an address half typed is not called wrong.
  const [toChecked, setToChecked] = useState(false);
  const badRecipients = toChecked ? invalidMailRecipients(step.config.to ?? '') : [];
  return (
    <Stack gap="xs">
      <SecretHealthAlert scopes={['smtp']} />
      {/* The mailboxes are entered once, on the Mail connector card. */}
      <MailAccountField
        purpose="send"
        value={step.config.account ?? ''}
        onChange={(account) => onChange({ ...step.config, account })}
        t={t}
      />
      <FieldPair>
        <AppTextInput
          label={t('flow.skill.email_send.to')}
          placeholder={t('flow.skill.email_send.to.placeholder')}
          value={step.config.to ?? ''}
          onChange={(e) => onChange({ ...step.config, to: e.currentTarget.value })}
          onBlur={() => setToChecked(true)}
          error={badRecipients.length > 0
            ? fillTemplate(t('flow.skill.email_send.to.invalid'), { address: badRecipients[0]! })
            : undefined}
          size="sm"
          mono
        />
        <AppTextInput
          label={t('flow.skill.email_send.subject')}
          placeholder={t('flow.skill.email_send.subject.placeholder')}
          value={step.config.subject ?? ''}
          onChange={(e) => onChange({ ...step.config, subject: e.currentTarget.value })}
          size="sm"
        />
      </FieldPair>
      <FieldLabelRow htmlFor={bodyId} label={t('flow.skill.email_send.body')}>
        {draftButton?.('body', 'emailBody', t('flow.skill.email_send.body'))}
      </FieldLabelRow>
      <AppTextarea
        id={bodyId}
        aria-label={t('flow.skill.email_send.body')}
        placeholder={t('flow.skill.email_send.body.placeholder')}
        value={step.config.body ?? ''}
        onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
        minRows={3}
        maxRows={12}
        autosize
        size="sm"
      />
      {/* One file per line or comma, as the placeholder says: a single-line box drops the breaks. */}
      <AppTextarea
        label={t('flow.skill.email_send.attachments')}
        placeholder={t('flow.skill.email_send.attachments.placeholder')}
        value={step.config.attachments ?? ''}
        onChange={(e) => onChange({ ...step.config, attachments: e.currentTarget.value })}
        minRows={1}
        autosize
        size="sm"
        mono
      />
      {(step.config.attachments ?? '').trim() && (
        <Text fz="xs" c="dimmed">{t('flow.skill.email_send.attachments.hint')}</Text>
      )}
      <AppTextInput
        label={t('flow.skill.email_send.fromName')}
        placeholder={t('flow.skill.email_send.fromName.placeholder')}
        value={step.config.fromName ?? ''}
        onChange={(e) => onChange({ ...step.config, fromName: e.currentTarget.value })}
        size="sm"
      />
    </Stack>
  );
};
