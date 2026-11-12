import React, { useState } from 'react';
import { Box, Collapse, Group, Stack, Text } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppTextInput } from '../../../components/AppTextInput';
import { GroupHeader } from '../../../components/GroupHeader';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { MailAccountField } from './MailAccountField';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { MAIL_FETCH_MAX_SEARCHES, mailFetchSearchCount, splitTerms } from '../../../../../shared/flowListTerms';
import type { SkillConfigProps } from './types';

/** The advanced options start open when any of them is not its default, so nothing set is hidden. */
export function mailFetchAdvancedSet(config: Record<string, string>): boolean {
  return Boolean(config.folder?.trim()) || config.withBody === 'false' || config.emitFailFlag === 'true';
}

/**
 * The sentence under the sender and keyword fields: with more than one search it says how many
 * (the run makes one per sender × keyword pair, at most `MAIL_FETCH_MAX_SEARCHES`).
 */
export function mailFetchSearchLine(config: Record<string, string>): { senders: number; keywords: number; total: number } {
  const senders = splitTerms(config.from ?? '').length;
  const keywords = splitTerms(config.keywords ?? '').length;
  return { senders, keywords, total: mailFetchSearchCount(config) };
}

/** The "read new mail" step: who from, which words, how far back; the account is the Mail connector's. */
export const MailFetchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const [advancedOpen, setAdvancedOpen] = useState(() => mailFetchAdvancedSet(step.config));
  const set = (key: string, value: string): void => onChange({ ...step.config, [key]: value });
  const toggle = (key: string, label: string, fallback: boolean): React.ReactNode => (
    <ToggleSwitch
      label={label}
      size="sm"
      checked={step.config[key] === undefined ? fallback : step.config[key] === 'true'}
      onChange={(e) => set(key, e.currentTarget.checked ? 'true' : 'false')}
    />
  );
  const searches = mailFetchSearchLine(step.config);
  const tooMany = searches.total > MAIL_FETCH_MAX_SEARCHES;
  const max = String(MAIL_FETCH_MAX_SEARCHES);

  return (
    <Stack gap="xs">
      <MailAccountField purpose="read" value={step.config.account ?? ''} onChange={(account) => set('account', account)} t={t} />

      <GroupHeader variant="plain" label={t('flow.skill.mail_fetch.group.filter')} />
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
        error={tooMany ? fillTemplate(t('flow.error.mailTooManyTerms'), { max }) : undefined}
        size="sm"
      />
      <Text fz="xs" c="var(--text-muted)">
        {t('flow.skill.mail_fetch.terms.hint')}
        {searches.total > 1 && !tooMany && ` ${fillTemplate(t('flow.skill.mail_fetch.terms.count'), {
          senders: String(Math.max(1, searches.senders)),
          keywords: String(Math.max(1, searches.keywords)),
          total: String(searches.total),
          max,
        })}`}
      </Text>
      {toggle('unreadOnly', t('flow.skill.mail_fetch.unreadOnly'), false)}
      {toggle('attachmentsOnly', t('flow.skill.mail_fetch.attachmentsOnly'), false)}

      <GroupHeader variant="plain" label={t('flow.skill.mail_fetch.group.range')} />
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
      {toggle('onlyNew', t('flow.skill.mail_fetch.onlyNew'), true)}
      <Text fz="xs" c="var(--text-muted)">
        {step.config.onlyNew === 'false' ? t('flow.skill.mail_fetch.onlyNew.offHint') : t('flow.skill.mail_fetch.onlyNew.hint')}
      </Text>

      <Box>
        <AppButton
          variant="subtle"
          size="compact-sm"
          leftSection={advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          px={0}
        >
          {t('flow.skill.mail_fetch.group.advanced')}
        </AppButton>
        <Collapse expanded={advancedOpen}>
          <Stack gap="xs" pt={4}>
            <AppTextInput
              label={t('flow.skill.mail_fetch.folder')}
              placeholder={t('flow.skill.mail_fetch.folder.placeholder')}
              value={step.config.folder ?? ''}
              onChange={(e) => set('folder', e.currentTarget.value)}
              size="sm"
            />
            {toggle('withBody', t('flow.skill.mail_fetch.withBody'), true)}
            <ToggleSwitch
              label={t('flow.skill.mail_fetch.emitFailFlag')}
              size="sm"
              checked={step.config.emitFailFlag === 'true'}
              onChange={(e) => set('emitFailFlag', e.currentTarget.checked ? 'true' : 'false')}
            />
            {step.config.emitFailFlag === 'true' && (
              <Text fz="xs" c="var(--text-muted)">
                {fillTemplate(t('flow.skill.mail_fetch.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
              </Text>
            )}
          </Stack>
        </Collapse>
      </Box>

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.mail_fetch.outputHint'), {
          list: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          count: `{{${step.outputKey}.count}}`,
        })}
      </Text>
    </Stack>
  );
};
