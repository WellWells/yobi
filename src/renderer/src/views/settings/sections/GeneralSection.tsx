import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  AppWindow, FolderOpen, ImageDown, Keyboard, Languages, MessageSquare,
} from 'lucide-react';
import {
  SectionCard, SettingRow, SelectDropdown, ToggleSwitch, SettingDivider,
  SectionTitle, HotkeyField,
} from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useHotkeyRecorder } from '../hooks/useHotkeyRecorder';
import type { useQuickExportRecorder } from '../hooks/useQuickExportRecorder';
import type { useSystemSettings } from '../hooks/useSystemSettings';

type HotkeyRecorder = ReturnType<typeof useHotkeyRecorder>;
type QuickExportRecorder = ReturnType<typeof useQuickExportRecorder>;
type SystemSettings = ReturnType<typeof useSystemSettings>;

interface Props {
  hotkey: HotkeyRecorder;
  quickExport: QuickExportRecorder;
  system: SystemSettings;
  t: (key: string) => string;
  locale: string;
  availableLocales: string[];
  onSetLocale: (locale: string) => Promise<void>;
  getLocaleLabel: (locale: string) => string;
  onOpenLanguagesFolder: () => Promise<void>;
  showSection: (tags: readonly string[], category: 'general') => boolean;
  sectionGap: number;
}

export const GeneralSection: React.FC<Props> = ({
  hotkey, quickExport, system, t, locale, availableLocales, onSetLocale, getLocaleLabel,
  onOpenLanguagesFolder, showSection, sectionGap,
}) => (
  <Box display={showSection(TAG_SETS.hotkey, 'general') || showSection(TAG_SETS.tray, 'general') || showSection(TAG_SETS.language, 'general') ? 'block' : 'none'}>

    {/*
      Both of the app's global bindings live here. They used to sit a page apart — capture in
      General, export in Export — which hid the fact that they are a deliberate pair (Alt+G and
      Alt+H, adjacent keys). What each shortcut PRODUCES still belongs to Export; only the key
      itself is a shortcut setting.
    */}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.hotkey, 'general') ? 'block' : 'none' }}>
      <SectionTitle icon={<Keyboard size={15} />} label={t('settings.hotkey')} />
      <Stack gap={14}>
        <SettingRow
          icon={<MessageSquare size={13} />}
          label={t('settings.hotkey.ask')}
          hint={t('settings.hotkey.ask.hint')}
          control={(
            <ToggleSwitch
              checked={hotkey.enabled}
              onChange={(e) => { hotkey.setEnabled(e.currentTarget.checked); }}
            />
          )}
        />
        {/* Switched off, the field is inert — dim it and take it out of the tab order. */}
        <Box style={{ opacity: hotkey.enabled ? 1 : 0.45 }}>
          <HotkeyField
            recorder={hotkey}
            t={t}
            label={t('settings.hotkey.ask')}
            disabled={!hotkey.enabled}
          />
        </Box>

        <SettingDivider />

        <SettingRow
          icon={<ImageDown size={13} />}
          label={t('settings.hotkey.export')}
          hint={t('settings.hotkey.export.hint')}
          control={(
            <ToggleSwitch
              checked={quickExport.enabled}
              onChange={(e) => { void quickExport.setEnabled(e.currentTarget.checked); }}
            />
          )}
        />
        {/* Switched off, the field is inert — dim it and take it out of the tab order. */}
        <Box style={{ opacity: quickExport.enabled ? 1 : 0.45 }}>
          <HotkeyField
            recorder={quickExport}
            t={t}
            label={t('settings.hotkey.export')}
            disabled={!quickExport.enabled}
          />
        </Box>
      </Stack>
      <Text fz="var(--font-size-sm)" mt={12} c="dimmed">{t('settings.hotkey.hint')}</Text>
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
