import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Loader, Menu, Stack, Text } from '@mantine/core';
import { CircleUserRound, LogIn, LogOut, MoreVertical, RotateCcw } from 'lucide-react';
import { SectionCard, GroupHeader, SectionTitle } from '../components';
import { AppButton } from '../../../components/AppButton';
import { WebDialog } from '../../../components/WebDialog';
import { getModelIconByUrl } from '../../../config/models';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useAccountSettings } from '../hooks/useAccountSettings';
import { AUTH_PROVIDERS, PROVIDERS, PROVIDER_LABELS, PROVIDER_URLS } from '../../../../../shared/types';
import type { AuthProvider, Provider } from '../../../../../shared/types';

type AccountSettings = ReturnType<typeof useAccountSettings>;

interface Props {
  account: AccountSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'accounts') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

function isAuthProvider(provider: Provider): provider is AuthProvider {
  return (AUTH_PROVIDERS as readonly string[]).includes(provider);
}

type PillState = 'in' | 'out' | 'checking' | 'ready';

const StatusPill: React.FC<{ state: PillState; t: (key: string) => string }> = ({ state, t }) => {
  if (state === 'checking') {
    return (
      <Group gap={6} align="center" wrap="nowrap">
        <Loader size={12} />
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.accounts.status.checking')}</Text>
      </Group>
    );
  }
  const label =
    state === 'in'
      ? t('settings.accounts.status.loggedIn')
      : state === 'out'
        ? t('settings.accounts.status.loggedOut')
        : t('settings.accounts.status.ready');
  return (
    <Badge variant="light" color={state === 'out' ? 'gray' : 'teal'} radius="sm" size="sm" tt="none" fw={500}>
      {label}
    </Badge>
  );
};

const RowMenu: React.FC<{ busy: boolean; onReset: () => void; t: (key: string) => string }> = ({ busy, onReset, t }) => (
  <Menu position="bottom-end" radius="sm" withinPortal zIndex={200}>
    <Menu.Target>
      <ActionIcon variant="default" size={30} aria-label={t('settings.accounts.menu.more')} loading={busy}>
        <MoreVertical size={14} />
      </ActionIcon>
    </Menu.Target>
    <Menu.Dropdown>
      <Menu.Item color="red" leftSection={<RotateCcw size={14} />} onClick={onReset}>
        {t('settings.accounts.reset.action')}
      </Menu.Item>
    </Menu.Dropdown>
  </Menu>
);

export const AccountsSection: React.FC<Props> = ({ account, t, showSection, isSearching, sectionGap }) => {
  const [confirmLogout, setConfirmLogout] = useState<AuthProvider | null>(null);
  const [confirmReset, setConfirmReset] = useState<Provider | null>(null);
  const confirmLabel = confirmLogout ? PROVIDER_LABELS[confirmLogout] : '';
  const resetLabel = confirmReset ? PROVIDER_LABELS[confirmReset] : '';
  const resetSignsOut =
    confirmReset !== null && isAuthProvider(confirmReset) && account.statuses[confirmReset] === true;
  const resetDetailKey = resetSignsOut
    ? 'settings.accounts.reset.confirm.detailSignOut'
    : 'settings.accounts.reset.confirm.detail';

  return (
    <Box>
      {isSearching && <GroupHeader label={t('settings.group.accounts')} />}

      <Box display={showSection(TAG_SETS.accounts, 'accounts') ? 'block' : 'none'}>
        <SectionCard style={{ marginBottom: sectionGap }}>
          <SectionTitle icon={<CircleUserRound size={15} />} label={t('settings.accounts.title')} />
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>
            {t('settings.accounts.hint')}
          </Text>

          <Stack gap={0}>
            {PROVIDERS.map((provider, index) => {
              const Icon = getModelIconByUrl(PROVIDER_URLS[provider]);
              const isAuth = isAuthProvider(provider);
              const loggedIn = isAuth ? account.statuses[provider] : null;
              const busy = account.busy[provider];
              const pillState: PillState = !isAuth
                ? 'ready'
                : loggedIn === null
                  ? 'checking'
                  : loggedIn
                    ? 'in'
                    : 'out';
              return (
                <Box
                  key={provider}
                  py={14}
                  style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
                >
                  <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                    <Group gap={10} align="flex-start" wrap="nowrap" flex={1} miw={0}>
                      <Box c="var(--mantine-color-default-color)" mt={2} style={{ flexShrink: 0 }}>
                        <Icon size={18} />
                      </Box>
                      <Stack gap={4} miw={0}>
                        <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">
                          {PROVIDER_LABELS[provider]}
                        </Text>
                        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>
                          {t(`settings.accounts.necessity.${provider}`)}
                        </Text>
                      </Stack>
                    </Group>

                    <Group gap={8} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                      <StatusPill state={pillState} t={t} />

                      {isAuth &&
                        (loggedIn ? (
                          <AppButton
                            variant="default"
                            size="xs"
                            leftSection={<LogOut size={13} />}
                            loading={busy}
                            onClick={() => setConfirmLogout(provider)}
                          >
                            {t('settings.accounts.logout')}
                          </AppButton>
                        ) : (
                          <AppButton
                            variant="filled"
                            size="xs"
                            leftSection={<LogIn size={13} />}
                            loading={busy}
                            disabled={loggedIn === null}
                            onClick={() => { void account.login(provider); }}
                          >
                            {t('settings.accounts.login')}
                          </AppButton>
                        ))}

                      <RowMenu busy={busy} onReset={() => setConfirmReset(provider)} t={t} />
                    </Group>
                  </Group>
                </Box>
              );
            })}
          </Stack>
        </SectionCard>
      </Box>

      <WebDialog
        open={confirmLogout !== null}
        title={t('settings.accounts.logout.confirm.title').replace('{{provider}}', confirmLabel)}
        description={t('settings.accounts.logout.confirm.detail').replace('{{provider}}', confirmLabel)}
        confirmText={t('settings.accounts.logout')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const provider = confirmLogout;
          setConfirmLogout(null);
          if (provider) void account.logout(provider);
        }}
        onCancel={() => setConfirmLogout(null)}
      />

      <WebDialog
        open={confirmReset !== null}
        title={t('settings.accounts.reset.confirm.title').replace('{{provider}}', resetLabel)}
        description={t(resetDetailKey).replace('{{provider}}', resetLabel)}
        confirmText={t('settings.accounts.reset')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const provider = confirmReset;
          setConfirmReset(null);
          if (provider) void account.clearData(provider);
        }}
        onCancel={() => setConfirmReset(null)}
      />
    </Box>
  );
};
