import React from 'react';
import { Divider, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { MailAccountField } from './MailAccountField';
import type { SkillConfigProps } from './types';

export const EmailSendConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <SecretHealthAlert scopes={['smtp']} />
    {/* The mailboxes are entered once, on the Mail connector card. */}
    <MailAccountField
      purpose="send"
      value={step.config.account ?? ''}
      onChange={(account) => onChange({ ...step.config, account })}
      t={t}
    />

    <Divider my={4} />

      <AppTextInput
        label={t('flow.skill.email_send.to')}
        placeholder={t('flow.skill.email_send.to.placeholder')}
        value={step.config.to ?? ''}
        onChange={(e) => onChange({ ...step.config, to: e.currentTarget.value })}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.email_send.subject')}
        placeholder={t('flow.skill.email_send.subject.placeholder')}
        value={step.config.subject ?? ''}
        onChange={(e) => onChange({ ...step.config, subject: e.currentTarget.value })}
        size="sm"
      />
      <AppTextarea
        label={t('flow.skill.email_send.body')}
        placeholder={t('flow.skill.email_send.body.placeholder')}
        value={step.config.body ?? ''}
        onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
        minRows={3}
        autosize
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.email_send.fromName')}
        placeholder={t('flow.skill.email_send.fromName.placeholder')}
        value={step.config.fromName ?? ''}
        onChange={(e) => onChange({ ...step.config, fromName: e.currentTarget.value })}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.email_send.attachments')}
        placeholder={t('flow.skill.email_send.attachments.placeholder')}
        value={step.config.attachments ?? ''}
        onChange={(e) => onChange({ ...step.config, attachments: e.currentTarget.value })}
        size="sm"
        mono
      />
      {(step.config.attachments ?? '').trim() && (
        <Text fz="xs" c="dimmed">{t('flow.skill.email_send.attachments.hint')}</Text>
      )}
  </Stack>
);
