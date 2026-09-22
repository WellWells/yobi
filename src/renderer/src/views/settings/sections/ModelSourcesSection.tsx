import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Loader, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { CircleUserRound, LogIn, LogOut, MoreVertical, RotateCcw } from 'lucide-react';
import { SectionCard, SectionTitle, VisibilityToggle } from '../components';
import { AppButton } from '../../../components/AppButton';
import { WebDialog } from '../../../components/WebDialog';
import { getModelIconByUrl } from '../../../config/models';
import { useHiddenSources } from '../hooks/useHiddenSources';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useAccountSettings } from '../hooks/useAccountSettings';
import {
  PROVIDERS, PROVIDER_LABELS, PROVIDER_URLS,
} from '../../../../../shared/types';
import type { AuthProvider, HiddenSources, Provider } from '../../../../../shared/types';
import { Z_POPOVER } from '../../../config/zLayers';

type AccountSettings = ReturnType<typeof useAccountSettings>;

interface Props {
  account: AccountSettings;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'accounts') => boolean;
  sectionGap: number;
}

type PillState = 'in' | 'out' | 'checking';

const StatusPill: React.FC<{ state: PillState; t: (key: string) => string }> = ({ state, t }) => {
  if (state === 'checking') {
    return (
      <Group gap={6} align="center" wrap="nowrap">
        <Loader size={12} />
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.accounts.status.checking')}</Text>
      </Group>
    );
  }
  const label = state === 'in'
    ? t('settings.accounts.status.loggedIn')
    : t('settings.accounts.status.loggedOut');
  return (
    <Badge variant="light" color={state === 'out' ? 'gray' : 'teal'} radius="sm" size="sm" tt="none" fw={500}>
      {label}
    </Badge>
  );
};

const RowMenu: React.FC<{
  busy: boolean;
  onLogout?: () => void;
  onReset: () => void;
  t: (key: string) => string;
}> = ({ busy, onLogout, onReset, t }) => (
  <Menu position="bottom-end" radius="sm" withinPortal zIndex={Z_POPOVER}>
    <Menu.Target>
      <Tooltip label={t('common.moreActions')} position="bottom">
        <ActionIcon variant="default" size={30} aria-label={t('common.moreActions')} loading={busy}>
          <MoreVertical size={14} />
        </ActionIcon>
      </Tooltip>
    </Menu.Target>
    <Menu.Dropdown>
      {onLogout && (
        <>
          <Menu.Item leftSection={<LogOut size={14} />} onClick={onLogout}>
            {t('settings.accounts.logout')}
          </Menu.Item>
          <Menu.Divider />
        </>
      )}
      <Menu.Item color="red" leftSection={<RotateCcw size={14} />} onClick={onReset}>
        {t('settings.accounts.reset.action')}
      </Menu.Item>
    </Menu.Dropdown>
  </Menu>
);

export const ModelSourcesSection: React.FC<Props> = ({ account, t, showSection, sectionGap }) => {
  const [confirmLogout, setConfirmLogout] = useState<AuthProvider | null>(null);
  const [confirmReset, setConfirmReset] = useState<Provider | null>(null);
  const sources = useHiddenSources();
  const confirmLabel = confirmLogout ? PROVIDER_LABELS[confirmLogout] : '';
  const resetLabel = confirmReset ? PROVIDER_LABELS[confirmReset] : '';
  const resetSignsOut = confirmReset !== null && account.statuses[confirmReset] === true;
  const resetDetailKey = resetSignsOut
    ? 'settings.accounts.reset.confirm.detailSignOut'
    : 'settings.accounts.reset.confirm.detail';

  return (
    <Box>
      <Box display={showSection(TAG_SETS.accounts, 'accounts') ? 'block' : 'none'}>
        <SectionCard style={{ marginBottom: sectionGap }}>
          <SectionTitle icon={<CircleUserRound size={15} />} label={t('settings.accounts.title')} />
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
            {t('settings.accounts.hint')}
          </Text>
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>
            {t('settings.modelSources.hint')}
          </Text>

          <Stack gap={0}>
            {PROVIDERS.map((provider, index) => {
              const Icon = getModelIconByUrl(PROVIDER_URLS[provider]);
              const loggedIn = account.statuses[provider];
              const busy = account.busy[provider];
              const pillState: PillState = loggedIn === null ? 'checking' : loggedIn ? 'in' : 'out';
              const providerHidden = sources.hidden.providers.includes(provider);
              const afterHiding: HiddenSources = {
                ...sources.hidden,
                providers: [...sources.hidden.providers, provider],
              };
              const blocked = !providerHidden && !sources.canApply(afterHiding);
              return (
                <Box
                  key={provider}
                  py={14}
                  style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
                >
                  <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                    <Group
                      gap={10}
                      align="flex-start"
                      wrap="nowrap"
                      flex={1}
                      miw={0}
                      opacity={providerHidden ? 0.55 : 1}
                    >
                      <Box c="var(--mantine-color-default-color)" mt={2} style={{ flexShrink: 0 }}>
                        <Icon size={18} />
                      </Box>
                      <Stack gap={4} miw={0}>
                        <Group gap={8} align="center" wrap="nowrap" miw={0}>
                          <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)">
                            {PROVIDER_LABELS[provider]}
                          </Text>
                          <StatusPill state={pillState} t={t} />
                        </Group>
                        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>
                          {t(`settings.accounts.necessity.${provider}`)}
                        </Text>
                      </Stack>
                    </Group>

                    <Group gap={8} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                      {loggedIn === false && (
                        <AppButton
                          variant="filled"
                          size="xs"
                          leftSection={<LogIn size={13} />}
                          loading={busy}
                          onClick={() => { void account.login(provider); }}
                        >
                          {t('settings.accounts.login')}
                        </AppButton>
                      )}

                      <RowMenu
                        busy={busy}
                        onLogout={loggedIn === true ? () => setConfirmLogout(provider) : undefined}
                        onReset={() => setConfirmReset(provider)}
                        t={t}
                      />

                      <VisibilityToggle
                        label={PROVIDER_LABELS[provider]}
                        checked={!providerHidden}
                        blocked={blocked}
                        busy={sources.busy}
                        onToggle={() => sources.toggleProvider(provider)}
                        t={t}
                      />
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
