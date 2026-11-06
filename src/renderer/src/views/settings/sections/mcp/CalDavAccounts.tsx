import React, { useEffect, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text } from '@mantine/core';
import { ExternalLink, LogIn, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { SelectDropdown, StatusLine } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput } from '../../../../components/AppTextInput';
import { AppPasswordInput } from '../../../../components/AppPasswordInput';
import { WebDialog } from '../../../../components/WebDialog';
import { calendarApi, clipboardApi } from '../../../../api/electronApi';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import { CALDAV_PROVIDERS, findCalDavProvider } from '../../../../../../shared/calDav';
import type { CalDavAccountSummary, CalDavProviderId, CalDavSnapshot } from '../../../../../../shared/calDav';

interface Props {
  t: (key: string) => string;
  /** Bumped when the mailboxes change, so the "sign in as mailbox" choices follow them. */
  mailboxesVersion: number;
  /** Called after the accounts change: their calendars join the list the flow step picks from. */
  onChanged: () => void;
}

interface FormState {
  /** null while adding a new account. */
  id: string | null;
  /** `mail:<id>` signs in as that mailbox; `p:<provider>` takes a user name and an app password. */
  source: string;
  server: string;
  username: string;
  password: string;
}

const EMPTY: CalDavSnapshot = { accounts: [], mailboxes: [] };

function providerOf(source: string): CalDavProviderId {
  return findCalDavProvider(source.startsWith('p:') ? source.slice(2) : 'custom').id;
}

/**
 * CalDAV accounts (iCloud, Fastmail, Nextcloud …): signed in with an app password, or as a mailbox
 * whose own sign-in reaches its calendars. Saving signs in and lists the calendars first, so an
 * account that is listed works.
 */
export const CalDavAccounts: React.FC<Props> = ({ t, mailboxesVersion, onChanged }) => {
  const [snapshot, setSnapshot] = useState<CalDavSnapshot>(EMPTY);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CalDavAccountSummary | null>(null);

  useEffect(() => {
    void calendarApi.listCalDav().then(setSnapshot);
  }, [mailboxesVersion]);

  const changed = (next: CalDavSnapshot): void => {
    setSnapshot(next);
    onChanged();
  };

  const openForm = (next: FormState | null): void => {
    setForm(next);
    setError('');
  };

  const patch = (fields: Partial<FormState>): void => setForm((prev) => (prev ? { ...prev, ...fields } : prev));

  const newForm = (): FormState => ({
    id: null,
    source: snapshot.mailboxes[0] ? `mail:${snapshot.mailboxes[0].id}` : 'p:icloud',
    server: '',
    username: '',
    password: '',
  });

  const editForm = (account: CalDavAccountSummary): FormState => ({
    id: account.id,
    source: account.mailAccountId ? `mail:${account.mailAccountId}` : `p:${account.provider}`,
    server: account.server,
    username: account.mailAccountId ? '' : account.username,
    password: '',
  });

  const save = async (): Promise<void> => {
    if (!form) return;
    setSaving(true);
    setError('');
    const mailAccountId = form.source.startsWith('mail:') ? form.source.slice(5) : '';
    const result = await calendarApi.saveCalDav({
      ...(form.id ? { id: form.id } : {}),
      provider: mailAccountId ? 'custom' : providerOf(form.source),
      server: form.server,
      username: form.username,
      password: form.password,
      ...(mailAccountId ? { mailAccountId } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setError(t(`settings.calendars.caldav.error.${result.error}`));
      return;
    }
    openForm(null);
    changed({ ...snapshot, accounts: result.accounts });
  };

  const refresh = async (account: CalDavAccountSummary): Promise<void> => {
    setRefreshing(account.id);
    setRowError(null);
    const result = await calendarApi.refreshCalDav(account.id);
    setRefreshing(null);
    changed({ ...snapshot, accounts: result.accounts });
    if (!result.ok) setRowError({ id: account.id, message: t(`settings.calendars.caldav.error.${result.error}`) });
  };

  const sourceOptions = [
    ...snapshot.mailboxes.map((mailbox) => ({
      value: `mail:${mailbox.id}`,
      label: fillTemplate(t('settings.calendars.caldav.useMailbox'), { address: mailbox.address }),
    })),
    ...CALDAV_PROVIDERS.map((provider) => ({ value: `p:${provider.id}`, label: t(`settings.calendars.caldav.provider.${provider.id}`) })),
  ];
  // A mailbox removed since the account was linked still shows what it was set to.
  const sourceKnown = form ? sourceOptions.some((option) => option.value === form.source) : true;
  const viaMailbox = Boolean(form?.source.startsWith('mail:'));
  const provider = findCalDavProvider(form ? providerOf(form.source) : 'custom');
  const canSave = Boolean(form) && sourceKnown && (viaMailbox || Boolean(
    form && form.username.trim() && (provider.server || form.server.trim()) && (form.password.trim() || form.id),
  ));

  const formView = form && (
    <Stack
      gap={8}
      mt={8}
      p={12}
      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)' }}
    >
      <SelectDropdown
        label={t('settings.calendars.caldav.source')}
        options={sourceOptions}
        value={sourceKnown ? form.source : null}
        onChange={(source) => patch({ source })}
        size="sm"
      />
      {viaMailbox ? (
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.calendars.caldav.useMailbox.hint')}</Text>
      ) : (
        <>
          {!provider.server && (
            <AppTextInput
              label={t('settings.calendars.caldav.server')}
              placeholder={t(`settings.calendars.caldav.server.placeholder.${provider.id === 'nextcloud' ? 'nextcloud' : 'custom'}`)}
              value={form.server}
              onChange={(e) => { const server = e.currentTarget.value; patch({ server }); }}
              mono
              size="sm"
            />
          )}
          <AppTextInput
            label={t('settings.calendars.caldav.username')}
            placeholder={t(provider.id === 'nextcloud' || provider.id === 'custom' ? 'settings.calendars.caldav.username.placeholder.custom' : 'settings.calendars.caldav.username.placeholder')}
            value={form.username}
            onChange={(e) => { const username = e.currentTarget.value; patch({ username }); }}
            size="sm"
          />
          <AppPasswordInput
            label={t('settings.calendars.caldav.password')}
            placeholder={form.id ? t('settings.calendars.caldav.password.keep') : ''}
            value={form.password}
            onChange={(e) => { const password = e.currentTarget.value; patch({ password }); }}
            size="sm"
          />
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.calendars.caldav.password.hint')}</Text>
          {provider.helpUrl && (
            <Group gap={8}>
              <AppButton
                size="compact-xs"
                variant="subtle"
                leftSection={<ExternalLink size={12} />}
                onClick={() => { void clipboardApi.openExternalUrl(provider.helpUrl ?? ''); }}
              >
                {t(`settings.calendars.caldav.help.${provider.id}`)}
              </AppButton>
            </Group>
          )}
        </>
      )}
      <Group justify="flex-end" gap={8} mt={4}>
        <AppButton variant="default" size="xs" onClick={() => openForm(null)} disabled={saving}>
          {t('dialog.cancel')}
        </AppButton>
        <AppButton
          variant="filled"
          size="xs"
          leftSection={<LogIn size={13} />}
          loading={saving}
          disabled={!canSave}
          onClick={() => { void save(); }}
        >
          {t('settings.calendars.caldav.save')}
        </AppButton>
      </Group>
      {error && <StatusLine tone="error">{error}</StatusLine>}
    </Stack>
  );

  return (
    <Box>
      {snapshot.accounts.length === 0 && !form && (
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} mb={8}>{t('settings.calendars.caldav.empty')}</Text>
      )}
      <Stack gap={0}>
        {snapshot.accounts.map((account, index) => {
          const editingThis = form?.id === account.id;
          return (
            <Box
              key={account.id}
              py={8}
              style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
            >
              <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                <Stack gap={2} miw={0} flex={1}>
                  <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" truncate>
                    {account.username}
                  </Text>
                  <Text fz="xs" c="dimmed" truncate>
                    {account.unreadable
                      ? t(account.mailAccountId ? 'settings.calendars.caldav.mailboxGone' : 'settings.calendars.caldav.unreadable')
                      : account.mailAccountId
                        ? fillTemplate(t('settings.calendars.caldav.viaMailbox'), { host: account.host })
                        : account.host}
                  </Text>
                </Stack>
                <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                  <ActionIcon
                    variant="default"
                    size={26}
                    aria-label={t('settings.calendars.caldav.refresh')}
                    loading={refreshing === account.id}
                    disabled={account.unreadable}
                    onClick={() => { void refresh(account); }}
                  >
                    <RefreshCw size={13} />
                  </ActionIcon>
                  <ActionIcon
                    variant={editingThis ? 'light' : 'default'}
                    size={26}
                    aria-label={t('settings.calendars.edit')}
                    onClick={() => openForm(editingThis ? null : editForm(account))}
                  >
                    <Pencil size={13} />
                  </ActionIcon>
                  <ActionIcon
                    variant="default"
                    size={26}
                    c="red"
                    aria-label={t('settings.calendars.caldav.remove')}
                    onClick={() => setConfirmDelete(account)}
                  >
                    <Trash2 size={13} />
                  </ActionIcon>
                </Group>
              </Group>
              <Group gap={6} mt={6}>
                {account.calendars.map((calendar) => (
                  <Group key={calendar.id} gap={4} wrap="nowrap">
                    <Text fz="xs">{calendar.name}</Text>
                    {!calendar.writable && <Badge size="xs" variant="default">{t('settings.calendars.caldav.readOnly')}</Badge>}
                  </Group>
                ))}
              </Group>
              {rowError?.id === account.id && <Box mt={8}><StatusLine tone="error">{rowError.message}</StatusLine></Box>}
              {editingThis && formView}
            </Box>
          );
        })}
      </Stack>

      {form && form.id === null ? formView : (
        <Group mt={snapshot.accounts.length > 0 ? 8 : 0}>
          <AppButton variant="default" size="compact-xs" leftSection={<Plus size={12} />} onClick={() => openForm(newForm())}>
            {t('settings.calendars.caldav.add')}
          </AppButton>
        </Group>
      )}

      <WebDialog
        open={confirmDelete !== null}
        title={fillTemplate(t('settings.calendars.caldav.remove.confirm.title'), { name: confirmDelete?.username ?? '' })}
        description={t('settings.calendars.caldav.remove.confirm.detail')}
        confirmText={t('settings.calendars.caldav.remove')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const account = confirmDelete;
          setConfirmDelete(null);
          if (!account) return;
          if (form?.id === account.id) openForm(null);
          void calendarApi.removeCalDav(account.id).then(changed);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Box>
  );
};
