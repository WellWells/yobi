import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { StatusLine } from '../../../components/StatusLine';
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

function sameAddress(account: MailAccountView, address: string): boolean {
  return account.user.toLowerCase() === address.toLowerCase();
}

/**
 * What the stored address is to this step: one of the usable mailboxes, a mailbox that exists but
 * can only send (a read step then fails with "send only", not "removed"), or gone from Settings.
 */
export function mailAccountState(
  accounts: readonly MailAccountView[],
  address: string,
  purpose: Props['purpose'],
): 'usable' | 'sendOnly' | 'missing' {
  const found = accounts.find((account) => sameAddress(account, address));
  if (found && usable(found, purpose)) return 'usable';
  if (found && purpose === 'read' && !found.readHost) return 'sendOnly';
  return 'missing';
}

/** The Microsoft mailboxes this step would use whose sign-in has expired: the run would fail. */
export function expiredSignIns(
  usableAccounts: readonly MailAccountView[],
  chosen: string,
  purpose: Props['purpose'],
  fallback: MailAccountView | undefined,
): MailAccountView[] {
  const used = chosen
    ? usableAccounts.filter((account) => sameAddress(account, chosen))
    : purpose === 'read' ? usableAccounts : fallback ? [fallback] : [];
  return used.filter((account) => account.auth === 'microsoft' && !account.hasPassword);
}

/**
 * Which of the Mail connector's mailboxes a mail step uses. The accounts are entered in Settings;
 * with one usable mailbox this is a line of text, with several a picker. Read again whenever the
 * view changes (Settings is a dialog inside the window, so closing it fires no window focus) and
 * on window focus, so a mailbox just added shows at once.
 */
export const MailAccountField: React.FC<Props> = ({ value, onChange, purpose, t }) => {
  const [snapshot, setSnapshot] = useState<EmailSettingsSnapshot | null>(null);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const currentView = useAppStore((s) => s.currentView);

  useEffect(() => {
    const refresh = (): void => { void emailApi.getSettings().then(setSnapshot); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [currentView]);

  const all = snapshot?.accounts ?? [];
  const accounts = all.filter((account) => usable(account, purpose));
  const fallback = accounts.find((account) => account.id === snapshot?.defaultId) ?? accounts[0];
  const chosen = value.trim();
  const state = chosen === '' || snapshot === null ? 'usable' : mailAccountState(all, chosen, purpose);
  const missing = state !== 'usable';
  const expired = expiredSignIns(accounts, chosen, purpose, fallback);
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
  const expiredLine = expired.length > 0 && (
    <StatusLine tone="warning">
      {fillTemplate(t('flow.skill.mail.account.signInExpired'), { address: expired.map((account) => account.user).join('、') })}
    </StatusLine>
  );

  if (accounts.length <= 1 && !missing) {
    return (
      <Stack gap={4}>
        <Group gap={8} wrap="nowrap" align="center">
          <Text fz="sm" c={fallback ? undefined : 'var(--mantine-color-warning)'} style={{ flex: 1 }}>
            {fallback ? fillTemplate(t(copy.one), { address: fallback.user }) : t(copy.none)}
          </Text>
          {settingsButton}
        </Group>
        {expiredLine}
      </Stack>
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
    ...(state === 'missing' ? [{ value: chosen, label: fillTemplate(t('flow.skill.mail.account.missing'), { address: chosen }) }] : []),
    ...(state === 'sendOnly' ? [{ value: chosen, label: fillTemplate(t('flow.skill.mail.account.sendOnly'), { address: chosen }) }] : []),
  ];
  const selected = missing ? chosen : (accounts.find((account) => sameAddress(account, chosen))?.user ?? '');
  const error = state === 'missing' ? t('flow.skill.mail.account.missing.hint')
    : state === 'sendOnly' ? t('flow.skill.mail.account.sendOnly.hint')
      : undefined;

  return (
    <Stack gap={4}>
      <Group gap={8} wrap="nowrap" align="flex-end">
        <SelectDropdown
          style={{ flex: 1 }}
          label={t(copy.label)}
          options={options}
          value={selected}
          onChange={onChange}
          error={error}
          size="sm"
        />
        {settingsButton}
      </Group>
      {expiredLine}
    </Stack>
  );
};
