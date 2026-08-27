import React from 'react';
import { ActionIcon, Box, Group, Stack, Tooltip } from '@mantine/core';
import {
  AppWindow, ChevronRight, FolderOpen, Keyboard, Languages,
} from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import {
  SectionCard, SettingRow, SelectDropdown, ToggleSwitch,
  SectionTitle,
} from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useSystemSettings } from '../hooks/useSystemSettings';

type SystemSettings = ReturnType<typeof useSystemSettings>;

interface Props {
  system: SystemSettings;
  t: (key: string) => string;
  locale: string;
  availableLocales: string[];
  onSetLocale: (locale: string) => Promise<void>;
  getLocaleLabel: (locale: string) => string;
  onOpenLanguagesFolder: () => Promise<void>;
  onOpenShortcuts: () => void;
  showSection: (tags: readonly string[], category: 'general') => boolean;
  sectionGap: number;
}

export const GeneralSection: React.FC<Props> = ({
  system, t, locale, availableLocales, onSetLocale, getLocaleLabel,
  onOpenLanguagesFolder, onOpenShortcuts, showSection, sectionGap,
}) => (
  <Box display={showSection(TAG_SETS.hotkey, 'general') || showSection(TAG_SETS.tray, 'general') || showSection(TAG_SETS.language, 'general') ? 'block' : 'none'}>

    {
}
    {
}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.language, 'general') ? 'block' : 'none' }}>
      <SettingRow
        icon={<Keyboard size={13} />}
        label={t('settings.hotkey')}
        hint={t('settings.shortcut.movedHint')}
        control={(
          <AppButton variant="subtle" size="xs" rightSection={<ChevronRight size={13} />} onClick={onOpenShortcuts}>
            {t('settings.group.shortcuts')}
          </AppButton>
        )}
      />
    </SectionCard>

    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.tray, 'general') ? 'block' : 'none' }}>
      {(() => {
        const isMac = navigator.userAgent.includes('Macintosh');
        return (
          <>
            <SectionTitle icon={<AppWindow size={15} />} label={isMac ? t('settings.tray.title.mac') : t('settings.tray.title')} />
            <Stack gap={14}>
              <SettingRow
                icon={<AppWindow size={13} />}
                label={isMac ? t('settings.tray.closeToTray.mac') : t('settings.tray.closeToTray')}
                hint={isMac ? t('settings.tray.closeToTray.hint.mac') : t('settings.tray.closeToTray.hint')}
                control={<ToggleSwitch checked={system.closeToTray} onChange={() => { void system.handleToggleCloseToTray(); }} />}
              />
              <SettingRow
                icon={<AppWindow size={13} />}
                label={t('settings.tray.launchAtStartup')}
                hint={t('settings.tray.launchAtStartup.hint')}
                control={<ToggleSwitch checked={system.launchAtStartup} onChange={() => { void system.handleToggleLaunchAtStartup(); }} />}
              />
            </Stack>
          </>
        );
      })()}
    </SectionCard>

    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.language, 'general') ? 'block' : 'none' }}>
      <SettingRow
        icon={<Languages size={13} />}
        label={t('settings.language')}
        hint={t('settings.language.customHint')}
        control={(
          <Group gap={6} wrap="nowrap">
            <SelectDropdown
              value={locale}
              options={availableLocales.map((l) => ({ value: l, label: getLocaleLabel(l) }))}
              onChange={(nextLocale) => { void onSetLocale(nextLocale); }}
            />
            <Tooltip label={t('settings.language.openFolder')} position="top">
              <ActionIcon
                variant="default"
                size={32}
                aria-label={t('settings.language.openFolder')}
                onClick={() => { void onOpenLanguagesFolder(); }}
              >
                <FolderOpen size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      />
    </SectionCard>

  </Box>
);
