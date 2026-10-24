import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { MailAccountField } from './MailAccountField';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillConfigProps } from './types';

/** The "read new mail" step: who from, which words, how far back; the account is the Mail connector's. */
export const MailFetchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const set = (key: string, value: string): void => onChange({ ...step.config, [key]: value });
  const toggle = (key: string, label: string, fallback: boolean): React.ReactNode => (
    <ToggleSwitch
      label={label}
      size="sm"
      checked={step.config[key] === undefined ? fallback : step.config[key] === 'true'}
      onChange={(e) => set(key, e.currentTarget.checked ? 'true' : 'false')}
    />
  );

  return (
    <Stack gap="xs">
      <MailAccountField purpose="read" value={step.config.account ?? ''} onChange={(account) => set('account', account)} t={t} />

      <AppTextInput
        label={t('flow.skill.mail_fetch.from')}
        placeholder={t('flow.skill.mail_fetch.from.placeholder')}
        value={step.config.from ?? ''}
        onChange={(e) => set('from', e.currentTarget.value)}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.mail_fetch.keywords')}
        placeholder={t('flow.skill.mail_fetch.keywords.placeholder')}
        value={step.config.keywords ?? ''}
        onChange={(e) => set('keywords', e.currentTarget.value)}
        size="sm"
      />
      <Text fz="xs" c="dimmed">{t('flow.skill.mail_fetch.terms.hint')}</Text>

      <Group grow gap="xs" align="flex-start">
        <AppNumberInput
          label={t('flow.skill.mail_fetch.days')}
          value={step.config.days ?? '1'}
          onChange={(v) => set('days', v === '' ? '' : String(v))}
          size="sm"
          min={1}
          max={60}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
        <AppNumberInput
          label={t('flow.skill.mail_fetch.limit')}
          value={step.config.limit ?? '10'}
          onChange={(v) => set('limit', v === '' ? '' : String(v))}
          size="sm"
          min={1}
          max={20}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
      </Group>
      <AppTextInput
        label={t('flow.skill.mail_fetch.folder')}
        placeholder={t('flow.skill.mail_fetch.folder.placeholder')}
        value={step.config.folder ?? ''}
        onChange={(e) => set('folder', e.currentTarget.value)}
        size="sm"
      />

      {toggle('onlyNew', t('flow.skill.mail_fetch.onlyNew'), true)}
      {toggle('unreadOnly', t('flow.skill.mail_fetch.unreadOnly'), false)}
      {toggle('attachmentsOnly', t('flow.skill.mail_fetch.attachmentsOnly'), false)}
      {toggle('withBody', t('flow.skill.mail_fetch.withBody'), true)}
      <ToggleSwitch
        label={t('flow.skill.mail_fetch.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => set('emitFailFlag', e.currentTarget.checked ? 'true' : 'false')}
      />
      {step.config.emitFailFlag === 'true' && (
        <Text fz="xs" c="dimmed">
          {fillTemplate(t('flow.skill.mail_fetch.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        </Text>
      )}

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.mail_fetch.outputHint'), {
          list: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          count: `{{${step.outputKey}.count}}`,
        })}
      </Text>
    </Stack>
  );
};
