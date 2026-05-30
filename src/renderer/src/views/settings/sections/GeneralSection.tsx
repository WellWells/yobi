// src/renderer/src/views/settings/sections/GeneralSection.tsx
import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Button as MButton } from '@mantine/core';
import {
  AppWindow, Bell, Keyboard, Languages, Palette, RotateCcw, X,
} from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { SectionCard, SettingRow, SelectDropdown, ToggleSwitch, GroupHeader, SectionTitle } from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useHotkeyRecorder } from '../hooks/useHotkeyRecorder';
import type { useSystemSettings } from '../hooks/useSystemSettings';

type HotkeyRecorder = ReturnType<typeof useHotkeyRecorder>;
type SystemSettings = ReturnType<typeof useSystemSettings>;

interface Props {
  // Hotkey
  hotkey: HotkeyRecorder;
  // System settings
  system: SystemSettings;
  // i18n
  t: (key: string) => string;
  locale: string;
  availableLocales: string[];
  onSetLocale: (locale: string) => Promise<void>;
  getLocaleLabel: (locale: string) => string;
  // Theme
  theme: string;
  onSetTheme: (theme: string) => void;
  // Nav helpers
  showSection: (tags: readonly string[], category: 'general') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const GeneralSection: React.FC<Props> = ({
  hotkey, system, t, locale, availableLocales, onSetLocale, getLocaleLabel,
  theme, onSetTheme, showSection, isSearching, sectionGap,
}) => (
  <Box display={showSection(TAG_SETS.hotkey, 'general') || showSection(TAG_SETS.notify, 'general') || showSection(TAG_SETS.tray, 'general') || showSection(TAG_SETS.language, 'general') || showSection(TAG_SETS.theme, 'general') ? 'block' : 'none'}>
    {isSearching && <GroupHeader label={t('settings.group.general')} />}

    {/* ─ Hotkey ─ */}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.hotkey, 'general') ? 'block' : 'none' }}>
      <SectionTitle icon={<Keyboard size={15} />} label={t('settings.hotkey')} />
      <Group gap={8} align="center">
        <Box flex={1} pos="relative">
          <AppTextInput
            readOnly
            value={hotkey.recording ? '' : hotkey.hotkeyInput}
            tone={hotkey.recording ? 'recording' : 'tertiary'}
            mono
            onKeyDown={hotkey.handleHotkeyKeyDown}
            onFocus={() => hotkey.setRecording(true)}
            onBlur={() => hotkey.setRecording(false)}
            placeholder={hotkey.recording
              ? t('settings.hotkey.recording')
              : t('settings.hotkey.placeholder')}
            rightSection={hotkey.recording ? (
              <Box
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--mantine-color-accent)',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }}
              />
            ) : undefined}
          />
        </Box>
        {hotkey.recording ? (
          <MButton
            variant="light"
            size="sm"
            leftSection={<X size={13} />}
            onMouseDown={(e) => {
              e.preventDefault();
              hotkey.setRecording(false);
              hotkey.setHotkeyInput(hotkey.currentHotkey);
            }}
          >
            {t('settings.hotkey.cancelRecording')}
          </MButton>
        ) : (
          <ActionIcon
            variant="default"
            size={32}
            onClick={() => { void hotkey.handleClearHotkey(); }}
            title={t('settings.hotkey.resetDefault')}
          >
            <RotateCcw size={14} />
          </ActionIcon>
        )}
      </Group>
      <Text fz="var(--font-size-sm)" mt={8} c="dimmed">{t('settings.hotkey.hint')}</Text>
    </SectionCard>

    {/* ─ Notification ─ */}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.notify, 'general') ? 'block' : 'none' }}>
      <SectionTitle icon={<Bell size={15} />} label={t('settings.notifications')} />
      <SettingRow
        icon={<Bell size={13} />}
        label={t('settings.notifications.hint')}
        control={<ToggleSwitch checked={system.notifyOnComplete} onChange={() => { void system.handleToggleNotification(); }} />}
      />
    </SectionCard>

    {/* ─ System Tray ─ */}
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

    {/* ─ Language ─ */}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.language, 'general') ? 'block' : 'none' }}>
      <SettingRow
        icon={<Languages size={13} />}
        label={t('settings.language')}
        control={(
          <SelectDropdown
            value={locale}
            options={availableLocales.map((l) => ({ value: l, label: getLocaleLabel(l) }))}
            onChange={(nextLocale) => { void onSetLocale(nextLocale); }}
          />
        )}
      />
    </SectionCard>

    {/* ─ Theme ─ */}
    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.theme, 'general') ? 'block' : 'none' }}>
      <SettingRow
        icon={<Palette size={13} />}
        label={t('settings.theme')}
        hint={t('settings.theme.hint')}
        control={
          <SelectDropdown
            value={theme}
            options={[
              { value: 'dark', label: t('settings.theme.dark') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dracula', label: t('settings.theme.dracula') },
              { value: 'nord', label: t('settings.theme.nord') },
              { value: 'amoled', label: t('settings.theme.amoled') },
              { value: 'sepia', label: t('settings.theme.sepia') },
              { value: 'catppuccin', label: t('settings.theme.catppuccin') },
              { value: 'everforest', label: t('settings.theme.everforest') },
              { value: 'rosepine', label: t('settings.theme.rosepine') },
              { value: 'gruvbox', label: t('settings.theme.gruvbox') },
              { value: 'cyberpunk', label: t('settings.theme.cyberpunk') },
            ]}
            onChange={onSetTheme}
          />
        }
      />
    </SectionCard>
  </Box>
);
