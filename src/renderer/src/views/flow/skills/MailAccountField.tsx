import React, { useEffect, useState } from 'react';
import { Group, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { emailApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { EmailSettingsSnapshot, MailAccountView } from '../../../../../shared/types';

interface Props {
  /** The step's `account`: an address, or '' for the default (sending) / every mailbox (reading). */
  value: string;
  onChange: (value: string) => void;
  /** Sending needs SMTP; reading also needs an incoming server. */
  purpose: 'send' | 'read';
  t: (key: string) => string;
}

// Whole keys, so the i18n check sees them: it only follows `prefix.${name}`, not a computed prefix.
const COPY = {
  send: { one: 'flow.skill.email_send.account', none: 'flow.skill.email_send.noAccount', label: 'flow.skill.email_send.account.label' },
  read: { one: 'flow.skill.mail_fetch.account', none: 'flow.skill.mail_fetch.noAccount', label: 'flow.skill.mail_fetch.account.label' },
} as const;

function usable(account: MailAccountView, purpose: Props['purpose']): boolean {
  // A Microsoft mailbox whose sign-in expired still counts: the step then says "sign in again".
  return (account.hasPassword || account.auth === 'microsoft') && Boolean(account.host) && (purpose === 'send' || Boolean(account.readHost));
}

/**
 * Which of the Mail connector's mailboxes a mail step uses. The accounts are entered in Settings;
 * with one usable mailbox this is a line of text, with several a picker. Refreshed on focus so
 * coming back from Settings shows the mailbox just added.
 */
export const MailAccountField: React.FC<Props> = ({ value, onChange, purpose, t }) => {
  const [snapshot, setSnapshot] = useState<EmailSettingsSnapshot | null>(null);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);

  useEffect(() => {
    const refresh = (): void => { void emailApi.getSettings().then(setSnapshot); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const accounts = (snapshot?.accounts ?? []).filter((account) => usable(account, purpose));
  const fallback = accounts.find((account) => account.id === snapshot?.defaultId) ?? accounts[0];
  const chosen = value.trim();
  const missing = chosen !== '' && !accounts.some((account) => account.user.toLowerCase() === chosen.toLowerCase());
  const copy = COPY[purpose];

  const settingsButton = (
    <AppButton
      variant="default"
      size="compact-xs"
      leftSection={<Settings size={12} />}
      onClick={() => openSettingsCategory('connectors')}
      style={{ flexShrink: 0 }}
    >
      {t('flow.setup.openSettings')}
    </AppButton>
  );

  if (accounts.length <= 1 && !missing) {
    return (
      <Group gap={8} wrap="nowrap" align="center">
        <Text fz="sm" c={fallback ? undefined : 'var(--mantine-color-warning)'} style={{ flex: 1 }}>
          {fallback ? fillTemplate(t(copy.one), { address: fallback.user }) : t(copy.none)}
        </Text>
        {settingsButton}
      </Group>
    );
  }

  const options = [
    {
      value: '',
      label: purpose === 'send'
        ? fillTemplate(t('flow.skill.email_send.account.default'), { address: fallback?.user ?? '' })
        : t('flow.skill.mail_fetch.account.all'),
    },
    ...accounts.map((account) => ({ value: account.user, label: account.user })),
    ...(missing ? [{ value: chosen, label: fillTemplate(t('flow.skill.mail.account.missing'), { address: chosen }) }] : []),
  ];
  const selected = missing ? chosen : (accounts.find((account) => account.user.toLowerCase() === chosen.toLowerCase())?.user ?? '');

  return (
    <Group gap={8} wrap="nowrap" align="flex-end">
      <SelectDropdown
        style={{ flex: 1 }}
        label={t(copy.label)}
        options={options}
        value={selected}
        onChange={onChange}
        error={missing ? t('flow.skill.mail.account.missing.hint') : undefined}
        size="sm"
      />
      {settingsButton}
    </Group>
  );
};
