import React, { useEffect, useState } from 'react';
import { Group, Text } from '@mantine/core';
import { LogIn, LogOut } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { WebDialog } from '../../../../components/WebDialog';
import { siteAccountApi } from '../../../../api/electronApi';
import { useSiteAccountStatus } from '../../../../hooks/useSiteAccountStatus';
import { SITE_ACCOUNT_LABELS } from '../../../../../../shared/types';
import { AccountStatusPill, pillStateOf } from '../AccountStatusPill';

interface Props {
  t: (key: string) => string;
}

/** The X sign-in on the X connector card. Flows read with it too, so it shows whether the connector is on or off. */
export const XSignInRow: React.FC<Props> = ({ t }) => {
  const loggedIn = useSiteAccountStatus('x');
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const label = SITE_ACCOUNT_LABELS.x;

  // Every outcome of the sign-in window, including closing it without signing in, ends in a status event.
  useEffect(() => siteAccountApi.onStatusChanged(() => setBusy(false)), []);

  const login = async (): Promise<void> => {
    setBusy(true);
    const opened = await siteAccountApi.openLogin('x');
    if (!opened) setBusy(false);
  };

  const logout = async (): Promise<void> => {
    setBusy(true);
    try {
      await siteAccountApi.logout('x');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap={10}>
      <Group gap={8} align="center" wrap="nowrap" miw={0}>
        <AccountStatusPill state={pillStateOf(loggedIn)} t={t} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>
          {t(loggedIn ? 'settings.mcp.x.signedIn' : 'settings.mcp.x.signedOut')}
        </Text>
      </Group>
      {loggedIn === false && (
        <AppButton variant="filled" size="compact-xs" leftSection={<LogIn size={12} />} loading={busy} onClick={() => { void login(); }}>
          {t('settings.accounts.login')}
        </AppButton>
      )}
      {loggedIn === true && (
        <AppButton variant="default" size="compact-xs" leftSection={<LogOut size={12} />} loading={busy} onClick={() => setConfirmLogout(true)}>
          {t('settings.accounts.logout')}
        </AppButton>
      )}

      <WebDialog
        open={confirmLogout}
        title={t('settings.accounts.logout.confirm.title').replace('{{provider}}', label)}
        description={t('settings.accounts.logout.confirm.detail').replace('{{provider}}', label)}
        confirmText={t('settings.accounts.logout')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          setConfirmLogout(false);
          void logout();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </Group>
  );
};
