import React, { useEffect, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text } from '@mantine/core';
import { ChevronDown, ChevronRight, ExternalLink, LogIn, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppNumberInput } from '../../../../components/AppNumberInput';
import { AppPasswordInput } from '../../../../components/AppPasswordInput';
import { AppTextInput } from '../../../../components/AppTextInput';
import { StatusLine } from '../../../../components/StatusLine';
import { WebDialog } from '../../../../components/WebDialog';
import { SecretHealthAlert } from '../../../../components/SecretHealthAlert';
import { clipboardApi, emailApi } from '../../../../api/electronApi';
import { detectMailProvider } from '../../../../../../shared/mailProviders';
import { microsoftSignInAvailable } from '../../../../../../shared/microsoftMail';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import type { EmailSettingsSnapshot, MailAccountView } from '../../../../../../shared/types';

interface Props {
  t: (key: string) => string;
  /** Called after the accounts change, so a caller showing them can refresh. */
  onSaved?: () => void;
}

interface Servers {
  host: string;
  port: number;
  imapHost: string;
  imapPort: number;
}

interface FormState extends Servers {
  /** '' while adding a new mailbox. */
  id: string;
  address: string;
  password: string;
  hasPassword: boolean;
}

const EMPTY_FORM: FormState = { id: '', address: '', password: '', hasPassword: false, host: '', port: 587, imapHost: '', imapPort: 993 };

function formFor(account: MailAccountView): FormState {
  return {
    id: account.id, address: account.user, password: '', hasPassword: account.hasPassword,
    host: account.host, port: account.port, imapHost: account.imapHost, imapPort: account.imapPort,
  };
}

/** The one place mailboxes are entered: the email step and the Mail connector both use them. */
export const MailAccountSetup: React.FC<Props> = ({ t, onSaved }) => {
  const [snapshot, setSnapshot] = useState<EmailSettingsSnapshot>({ accounts: [], defaultId: '' });
  const [form, setForm] = useState<FormState | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<MailAccountView | null>(null);
  /** Which Microsoft sign-in is open in the browser: a mailbox id, or 'new'. */
  const [msBusy, setMsBusy] = useState<string | null>(null);
  const [msError, setMsError] = useState('');
  const msAvailable = microsoftSignInAvailable();

  const refresh = async (): Promise<void> => {
    setSnapshot(await emailApi.getSettings());
  };

  useEffect(() => { void refresh(); }, []);

  const changed = (next: EmailSettingsSnapshot): void => {
    setSnapshot(next);
    onSaved?.();
  };

  const openForm = (next: FormState | null): void => {
    setForm(next);
    setAdvanced(false);
    setError('');
  };

  const patch = (fields: Partial<FormState>): void => setForm((prev) => (prev ? { ...prev, ...fields } : prev));

  const provider = detectMailProvider(form?.address ?? '');

  // Typing a known address fills its servers, until the user edits them under "Advanced".
  const changeAddress = (value: string): void => {
    setError('');
    const match = detectMailProvider(value);
    if (!advanced && match.kind === 'preset') {
      patch({ address: value, host: match.provider.smtp.host, port: match.provider.smtp.port, imapHost: '', imapPort: 993 });
      return;
    }
    patch({ address: value });
  };

  const save = async (): Promise<void> => {
    if (!form) return;
    setBusy(true);
    setError('');
    const { id, address, password, host, port, imapHost, imapPort } = form;
    const result = await emailApi.saveAccount({ id, user: address.trim(), password, host, port, imapHost, imapPort });
    setBusy(false);
    if (!result.ok) {
      setError(fillTemplate(t(result.errorKey), result.vars));
      if (result.stage !== 'input' && provider.kind === 'unknown') setAdvanced(true);
      return;
    }
    openForm(null);
    changed(await emailApi.getSettings());
  };

  // Opens Microsoft's sign-in in the browser; `id` signs an existing Microsoft mailbox in again.
  // An error is shown where the sign-in was started: in the open form, else under the list.
  const signInMicrosoft = async (id?: string): Promise<void> => {
    const fromForm = form !== null && !id;
    setMsBusy(id ?? 'new');
    setMsError('');
    setError('');
    const result = await emailApi.signInMicrosoft(id);
    setMsBusy(null);
    if (!result.ok) {
      const message = fillTemplate(t(result.errorKey), result.vars);
      if (fromForm) setError(message);
      else setMsError(message);
      return;
    }
    openForm(null);
    changed(await emailApi.getSettings());
  };

  const microsoftOnly = provider.kind === 'preset' && provider.provider.signIn === 'microsoft';
  const showServers = Boolean(form) && !microsoftOnly
    && (advanced || (provider.kind === 'unknown' && Boolean(form?.address.includes('@'))));

  // While Microsoft's page is open in the browser the button waits; "Cancel" stops the wait (the
  // user may have closed the tab, which Yobi cannot see).
  const microsoftButton = (busyKey: string, label: string, onClick: () => void) => (
    <Group gap={4} wrap="nowrap">
      <AppButton
        size="compact-xs"
        variant="default"
        leftSection={<LogIn size={12} />}
        loading={msBusy === busyKey}
        disabled={!msAvailable || (msBusy !== null && msBusy !== busyKey)}
        onClick={onClick}
      >
        {label}
      </AppButton>
      {msBusy === busyKey && (
        <AppButton size="compact-xs" variant="subtle" onClick={() => { void emailApi.cancelMicrosoft(); }}>
          {t('dialog.cancel')}
        </AppButton>
      )}
    </Group>
  );
  const several = snapshot.accounts.length > 1;

  const formView = form && (
    <Stack
      gap={8}
      mt={8}
      p={12}
      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)' }}
    >
      <AppTextInput
        label={t('settings.mail.address')}
        placeholder={t('settings.mail.address.placeholder')}
        value={form.address}
        onChange={(e) => changeAddress(e.currentTarget.value)}
        size="sm"
        tone="body"
      />
      {microsoftOnly ? (
        <Stack gap={6}>
          <Text fz="xs" c="dimmed" lh={1.5}>{t(msAvailable ? 'settings.mail.microsoft.hint' : 'settings.mail.microsoft.unavailable')}</Text>
          <Group gap={8}>
            {microsoftButton('new', t('settings.mail.microsoft.signIn'), () => { void signInMicrosoft(); })}
          </Group>
        </Stack>
      ) : (
        <>
          <AppPasswordInput
            label={t('settings.mail.password')}
            placeholder={form.hasPassword ? t('settings.mail.password.keep') : ''}
            value={form.password}
            onChange={(e) => { const password = e.currentTarget.value; patch({ password }); }}
            size="sm"
            tone="body"
          />
          {provider.kind === 'preset' && provider.provider.helpUrl && (
            <Group gap={8}>
              <AppButton
                size="compact-xs"
                variant="subtle"
                leftSection={<ExternalLink size={12} />}
                onClick={() => { void clipboardApi.openExternalUrl(provider.provider.helpUrl ?? ''); }}
              >
                {t(`settings.mail.help.${provider.provider.id}`)}
              </AppButton>
            </Group>
          )}
          <Group gap={8}>
            <AppButton
              size="compact-xs"
              variant="subtle"
              leftSection={showServers ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              onClick={() => setAdvanced((open) => !open)}
            >
              {t('settings.mail.advanced')}
            </AppButton>
          </Group>
        </>
      )}
      {showServers && (
        <Stack gap={8}>
          <Group gap={8} align="flex-end" wrap="nowrap">
            <AppTextInput
              flex={1}
              label={t('settings.mail.smtpHost')}
              value={form.host}
              onChange={(e) => { const host = e.currentTarget.value; patch({ host }); }}
              size="sm"
              tone="body"
            />
            <AppNumberInput
              w={96}
              label={t('settings.mail.port')}
              value={form.port}
              onChange={(v) => patch({ port: Number(v) || 587 })}
              min={1}
              max={65_535}
              size="sm"
              tone="body"
            />
          </Group>
          <Group gap={8} align="flex-end" wrap="nowrap">
            <AppTextInput
              flex={1}
              label={t('settings.mail.imapHost')}
              placeholder={provider.kind === 'preset' ? provider.provider.imap.host : ''}
              value={form.imapHost}
              onChange={(e) => { const imapHost = e.currentTarget.value; patch({ imapHost }); }}
              size="sm"
              tone="body"
            />
            <AppNumberInput
              w={96}
              label={t('settings.mail.port')}
              value={form.imapPort}
              onChange={(v) => patch({ imapPort: Number(v) || 993 })}
              min={1}
              max={65_535}
              size="sm"
              tone="body"
            />
          </Group>
          <Text fz="xs" c="dimmed">{t('settings.mail.imapHost.hint')}</Text>
        </Stack>
      )}
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Group gap={8} justify="flex-end">
        <AppButton variant="default" size="xs" onClick={() => openForm(null)} disabled={busy}>
          {t('dialog.cancel')}
        </AppButton>
        {!microsoftOnly && (
          <AppButton
            size="xs"
            loading={busy}
            disabled={!form.address.trim() || !form.host.trim() || (!form.password && !form.hasPassword)}
            onClick={() => { void save(); }}
          >
            {t('settings.mail.save')}
          </AppButton>
        )}
      </Group>
    </Stack>
  );

  return (
    <Stack gap={8}>
      <SecretHealthAlert scopes={['smtp']} />
      {snapshot.accounts.length === 0 && !form && (
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>{t('settings.mail.account.unset')}</Text>
      )}
      <Stack gap={0}>
        {snapshot.accounts.map((account, index) => {
          const editingThis = form?.id === account.id;
          const isDefault = account.id === snapshot.defaultId;
          const microsoft = account.auth === 'microsoft';
          const statusKey = microsoft
            ? (account.hasPassword ? 'settings.mail.account.microsoft' : 'settings.mail.account.microsoftSignedOut')
            : !account.hasPassword ? 'settings.mail.account.noPassword'
              : account.readHost ? 'settings.mail.account.readSend' : 'settings.mail.account.sendOnly';
          return (
            <Box
              key={account.id}
              py={8}
              style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
            >
              <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                <Stack gap={2} miw={0} flex={1}>
                  <Group gap={6} wrap="nowrap" miw={0}>
                    <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" truncate>{account.user}</Text>
                    {several && isDefault && <Badge size="xs" variant="light">{t('settings.mail.account.default')}</Badge>}
                  </Group>
                  <Text fz="xs" c={microsoft && !account.hasPassword ? 'var(--mantine-color-warning)' : 'dimmed'} truncate>
                    {t(statusKey)}
                  </Text>
                </Stack>
                <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                  {several && !isDefault && (
                    <AppButton
                      variant="subtle"
                      size="compact-xs"
                      leftSection={<Star size={12} />}
                      onClick={() => { void emailApi.setDefault(account.id).then(changed); }}
                    >
                      {t('settings.mail.account.makeDefault')}
                    </AppButton>
                  )}
                  {microsoft ? (
                    // Nothing to edit on a Microsoft mailbox: its servers are fixed and its secret is the sign-in.
                    microsoftButton(account.id, t('settings.mail.microsoft.signInAgain'), () => { void signInMicrosoft(account.id); })
                  ) : (
                    <ActionIcon
                      variant={editingThis ? 'light' : 'default'}
                      size={26}
                      aria-label={t('settings.mail.account.change')}
                      onClick={() => openForm(editingThis ? null : formFor(account))}
                    >
                      <Pencil size={13} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    variant="default"
                    size={26}
                    c="red"
                    aria-label={t('settings.mail.account.remove')}
                    onClick={() => setConfirmRemove(account)}
                  >
                    <Trash2 size={13} />
                  </ActionIcon>
                </Group>
              </Group>
              {editingThis && formView}
            </Box>
          );
        })}
      </Stack>
      {form && form.id === '' ? formView : (
        <Group gap={8}>
          <AppButton size="compact-xs" variant="default" leftSection={<Plus size={12} />} onClick={() => openForm({ ...EMPTY_FORM })}>
            {t('settings.mail.account.add')}
          </AppButton>
          {msAvailable && microsoftButton('new', t('settings.mail.microsoft.signIn'), () => { void signInMicrosoft(); })}
        </Group>
      )}
      {msError && <StatusLine tone="error">{msError}</StatusLine>}
      <WebDialog
        open={confirmRemove !== null}
        title={fillTemplate(t('settings.mail.account.remove.confirm.title'), { address: confirmRemove?.user ?? '' })}
        description={t('settings.mail.account.remove.confirm.detail')}
        confirmText={t('settings.mail.account.remove')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const account = confirmRemove;
          setConfirmRemove(null);
          if (!account) return;
          if (form?.id === account.id) openForm(null);
          void emailApi.removeAccount(account.id).then(changed);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </Stack>
  );
};
