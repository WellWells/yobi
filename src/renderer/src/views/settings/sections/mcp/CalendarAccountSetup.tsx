import React, { useEffect, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text } from '@mantine/core';
import { FlaskConical, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { StatusLine } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput } from '../../../../components/AppTextInput';
import { AppPasswordInput } from '../../../../components/AppPasswordInput';
import { WebDialog } from '../../../../components/WebDialog';
import { SecretHealthAlert } from '../../../../components/SecretHealthAlert';
import { GroupHeader } from '../../../../components/GroupHeader';
import { CalDavAccounts } from './CalDavAccounts';
import { calendarApi } from '../../../../api/electronApi';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import { CALENDAR_NAME_MAX } from '../../../../../../shared/calendars';
import type { CalendarSummary, CalendarTestResult } from '../../../../../../shared/calendars';

interface Props {
  t: (key: string) => string;
  /** Bumped when the mailboxes change: a CalDAV account can sign in as one of them. */
  mailboxesVersion: number;
}

interface FormState {
  /** null while adding a new calendar. */
  id: string | null;
  name: string;
  url: string;
}

type TestState = { key: string; busy: true } | { key: string; busy: false; result: CalendarTestResult };

function testLine(state: TestState | null, key: string, t: (k: string) => string): React.ReactNode {
  if (!state || state.key !== key) return null;
  if (state.busy) return null;
  const { result } = state;
  if (result.ok) {
    return <StatusLine tone="success">{fillTemplate(t('settings.calendars.test.ok'), { count: result.count, days: result.days })}</StatusLine>;
  }
  return <StatusLine tone="error">{result.error}</StatusLine>;
}

/**
 * The one place calendars are entered, on the Calendar connector's card: the calendar step and
 * the connector both use them. CalDAV accounts (read and write) and .ics subscriptions (read
 * only: a name and the calendar's .ics address). The address is a secret, so it is only ever
 * typed here; the list shows each feed's host.
 */
export const CalendarAccountSetup: React.FC<Props> = ({ t, mailboxesVersion }) => {
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CalendarSummary | null>(null);

  useEffect(() => { void calendarApi.list().then(setCalendars); }, []);
  const subscriptions = calendars.filter((calendar) => calendar.kind === 'ics');

  const openForm = (next: FormState): void => {
    setForm(next);
    setSaveError('');
    setTest(null);
  };

  const runTest = async (key: string, id: string | undefined, url: string): Promise<void> => {
    setTest({ key, busy: true });
    const result = await calendarApi.test({ ...(id ? { id } : {}), url });
    setTest({ key, busy: false, result });
  };

  const save = async (): Promise<void> => {
    if (!form) return;
    setSaving(true);
    const result = await calendarApi.save({ ...(form.id ? { id: form.id } : {}), name: form.name, url: form.url });
    setSaving(false);
    if (!result.ok) {
      setSaveError(t(`settings.calendars.error.${result.error}`));
      return;
    }
    setCalendars(result.calendars);
    setForm(null);
  };

  const formKey = form ? `form:${form.id ?? 'new'}` : '';
  const canSave = Boolean(form && form.name.trim() && (form.id || form.url.trim()));
  const canTest = Boolean(form && (form.url.trim() || form.id));

  const formView = form && (
    <Stack
      gap="xs"
      mt={12}
      p={12}
      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)' }}
    >
      <AppTextInput
        label={t('settings.calendars.name')}
        placeholder={t('settings.calendars.name.placeholder')}
        value={form.name}
        maxLength={CALENDAR_NAME_MAX}
        onChange={(e) => { const name = e.currentTarget.value; setForm((prev) => (prev ? { ...prev, name } : prev)); }}
        size="sm"
      />
      <AppPasswordInput
        label={t('settings.calendars.url')}
        placeholder={form.id ? t('settings.calendars.url.placeholder.keep') : t('settings.calendars.url.placeholder')}
        value={form.url}
        onChange={(e) => { const url = e.currentTarget.value; setForm((prev) => (prev ? { ...prev, url } : prev)); }}
        mono
        size="sm"
      />
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.calendars.url.hint')}</Text>
      <Group justify="space-between" gap={8} mt={4} wrap="nowrap">
        <AppButton
          variant="default"
          size="xs"
          leftSection={<FlaskConical size={13} />}
          loading={test?.key === formKey && test.busy}
          disabled={!canTest}
          onClick={() => { void runTest(formKey, form.id ?? undefined, form.url); }}
        >
          {t('settings.calendars.test')}
        </AppButton>
        <Group gap={8}>
          <AppButton variant="default" size="xs" onClick={() => setForm(null)} disabled={saving}>
            {t('dialog.cancel')}
          </AppButton>
          <AppButton
            variant="filled"
            size="xs"
            leftSection={<Save size={13} />}
            loading={saving}
            disabled={!canSave}
            onClick={() => { void save(); }}
          >
            {t('settings.calendars.save')}
          </AppButton>
        </Group>
      </Group>
      {testLine(test, formKey, t)}
      {saveError && <StatusLine tone="error">{saveError}</StatusLine>}
    </Stack>
  );

  return (
    <Stack gap={8}>
      <SecretHealthAlert scopes={['calendar']} />

      <GroupHeader label={t('settings.calendars.caldav.heading')} variant="plain" />
      <CalDavAccounts t={t} mailboxesVersion={mailboxesVersion} onChanged={() => { void calendarApi.list().then(setCalendars); }} />

      <Box mt={12}><GroupHeader label={t('settings.calendars.ics.heading')} variant="plain" /></Box>
      {subscriptions.length === 0 && !form && (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.calendars.empty')}</Text>
      )}

      <Stack gap={0}>
        {subscriptions.map((calendar, index) => {
          const editingThis = form?.id === calendar.id;
          const rowKey = `row:${calendar.id}`;
          return (
            <Box
              key={calendar.id}
              py={8}
              style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
            >
              <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                <Stack gap={2} miw={0} flex={1}>
                  <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" truncate>
                    {calendar.name}
                  </Text>
                  <Text fz="xs" c="dimmed" truncate>
                    {calendar.unreadable ? t('settings.calendars.unreadable') : calendar.host}
                  </Text>
                </Stack>
                <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                  <AppButton
                    variant="default"
                    size="compact-xs"
                    leftSection={<FlaskConical size={12} />}
                    loading={test?.key === rowKey && test.busy}
                    disabled={calendar.unreadable}
                    onClick={() => { void runTest(rowKey, calendar.id, ''); }}
                  >
                    {t('settings.calendars.test')}
                  </AppButton>
                  <ActionIcon
                    variant={editingThis ? 'light' : 'default'}
                    size={26}
                    aria-label={t('settings.calendars.edit')}
                    onClick={() => (editingThis ? setForm(null) : openForm({ id: calendar.id, name: calendar.name, url: '' }))}
                  >
                    <Pencil size={13} />
                  </ActionIcon>
                  <ActionIcon
                    variant="default"
                    size={26}
                    c="red"
                    aria-label={t('settings.calendars.delete')}
                    onClick={() => setConfirmDelete(calendar)}
                  >
                    <Trash2 size={13} />
                  </ActionIcon>
                </Group>
              </Group>
              {test?.key === rowKey && <Box mt={8}>{testLine(test, rowKey, t)}</Box>}
              {editingThis && formView}
            </Box>
          );
        })}
      </Stack>

      {form && form.id === null ? formView : (
        <Group gap={8}>
          <AppButton
            variant="default"
            size="compact-xs"
            leftSection={<Plus size={12} />}
            onClick={() => openForm({ id: null, name: '', url: '' })}
          >
            {t('settings.calendars.add')}
          </AppButton>
        </Group>
      )}

      <WebDialog
        open={confirmDelete !== null}
        title={fillTemplate(t('settings.calendars.delete.confirm.title'), { name: confirmDelete?.name ?? '' })}
        description={t('settings.calendars.delete.confirm.detail')}
        confirmText={t('settings.calendars.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const calendar = confirmDelete;
          setConfirmDelete(null);
          if (!calendar) return;
          if (form?.id === calendar.id) setForm(null);
          void calendarApi.remove(calendar.id).then(setCalendars);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Stack>
  );
};
