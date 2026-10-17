import React, { useEffect, useState } from 'react';
import { Group, Text } from '@mantine/core';
import { LogIn, LogOut } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { WebDialog } from '../../../../components/WebDialog';
import { siteAccountApi } from '../../../../api/electronApi';
import { useSiteAccountStatus } from '../../../../hooks/useSiteAccountStatus';
import { SITE_ACCOUNT_LABELS } from '../../../../../../shared/types';
import { bySite } from '../../../../../../shared/siteConnectors';
import type { SiteAccount } from '../../../../../../shared/types';
import { AccountStatusPill, pillStateOf } from '../AccountStatusPill';

interface Props {
  site: SiteAccount;
  t: (key: string) => string;
}

/** What each site's row says it can read signed in and signed out. */
const STATUS_KEYS: Record<SiteAccount, { signedIn: string; signedOut: string }> = {
  x: { signedIn: 'settings.mcp.x.signedIn', signedOut: 'settings.mcp.x.signedOut' },
  ...bySite(({ keys }) => ({ signedIn: keys.signedIn, signedOut: keys.signedOut })),
};

/**
 * The site sign-in on its connector card. Flows read with it too, so it shows whether the
 * connector is on or off.
 */
export const SiteSignInRow: React.FC<Props> = ({ site, t }) => {
  const loggedIn = useSiteAccountStatus(site);
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const label = SITE_ACCOUNT_LABELS[site];

  // Every outcome of the sign-in window, including closing it without signing in, ends in a status event.
  useEffect(() => siteAccountApi.onStatusChanged(() => setBusy(false)), []);

  const login = async (): Promise<void> => {
    setBusy(true);
    const opened = await siteAccountApi.openLogin(site);
    if (!opened) setBusy(false);
  };

  const logout = async (): Promise<void> => {
    setBusy(true);
    try {
      await siteAccountApi.logout(site);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap={10}>
      <Group gap={8} align="center" wrap="nowrap" miw={0} flex={1}>
        <AccountStatusPill state={pillStateOf(loggedIn)} t={t} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} miw={0}>
          {t(loggedIn ? STATUS_KEYS[site].signedIn : STATUS_KEYS[site].signedOut)}
        </Text>
      </Group>
      {/* The button keeps its whole label; only the hint beside the pill wraps. */}
      {loggedIn === false && (
        <AppButton variant="filled" size="compact-xs" leftSection={<LogIn size={12} />} loading={busy} onClick={() => { void login(); }} style={{ flexShrink: 0 }}>
          {t('settings.accounts.login')}
        </AppButton>
      )}
      {loggedIn === true && (
        <AppButton variant="default" size="compact-xs" leftSection={<LogOut size={12} />} loading={busy} onClick={() => setConfirmLogout(true)} style={{ flexShrink: 0 }}>
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
