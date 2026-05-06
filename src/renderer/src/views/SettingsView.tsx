// src/renderer/src/views/SettingsView.tsx
// Skeleton: only composes sub-modules. All business logic lives in hooks; all rendering lives in sections.
import React, { useCallback, useState } from 'react';
import { ActionIcon, Box, Flex, Group, Stack, Text, TextInput, Title } from '@mantine/core';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { useThemeStore } from '../store/themeStore';
import type { Theme } from '../store/themeStore';
import { settingsApi, fileApi, systemApi } from '../api/electronApi';
import type { SettingsSnapshot } from '../../../shared/types';

import { NavItem } from './settings/components';
import { useHotkeyRecorder } from './settings/hooks/useHotkeyRecorder';
import { usePromptPrefs } from './settings/hooks/usePromptPrefs';
import { useSystemSettings } from './settings/hooks/useSystemSettings';
import { useTelegramSettings } from './settings/hooks/useTelegramSettings';
import { useSettingsNav } from './settings/hooks/useSettingsNav';
import { GeneralSection } from './settings/sections/GeneralSection';
import { AiSection } from './settings/sections/AiSection';
import { TelegramSection } from './settings/sections/TelegramSection';
import { SystemSection } from './settings/sections/SystemSection';
import type { DangerAction } from './settings/sections/SystemSection';

const SECTION_GAP = 12;

export const SettingsView: React.FC = () => {
  const { t, locale, setLocale, availableLocales } = useI18nStore();
  const { setFiles, selectFile, setFileContent } = useAppStore();
  const { theme, setTheme } = useThemeStore();

  // ── Business logic hooks ──────────────────────────────────────────────────────────────────
  const hotkey = useHotkeyRecorder();
  const prefs = usePromptPrefs();
  const system = useSystemSettings();
  const telegram = useTelegramSettings();
  const nav = useSettingsNav();

  // Danger action confirmation state (coordinated across hooks)
  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
  const applySettingsSnapshot = useCallback(async (snapshot: SettingsSnapshot) => {
    hotkey.applyHotkeyReset(snapshot.hotkey);
    prefs.applyPromptReset(snapshot.promptPreferences, snapshot.syncSystemLanguageToModel);
    system.applySystemReset(
      snapshot.notifyOnComplete,
      snapshot.responseTimeout,
      snapshot.closeToTray,
      snapshot.launchAtStartup,
    );
    setTheme((snapshot.theme as Theme) ?? 'dark');
    await setLocale(snapshot.locale);
    await telegram.loadTelegramSettings();
  }, [hotkey, prefs, system, telegram, setTheme, setLocale]);

  // ── Locale label helper ───────────────────────────────────────────────────
  const localeKeyMap: Record<string, string> = {
    'en-US': 'language.name.enUS',
    'zh-TW': 'language.name.zhTW',
    'zh-CN': 'language.name.zhCN',
    'es':    'language.name.es',
    'ja':    'language.name.ja',
    'pt-BR': 'language.name.ptBR',
    'de':    'language.name.de',
    'fr':    'language.name.fr',
    'ko':    'language.name.ko',
  };
  const getLocaleLabel = useCallback((localeCode: string): string => {
    const key = localeKeyMap[localeCode];
    return key ? t(key) : localeCode;
  }, [t]);

  // ── Danger actions ────────────────────────────────────────────────────────
  const handleResetSettings = useCallback(async () => {
    const reset = await settingsApi.resetSettings();
    if (!reset) return;
    await applySettingsSnapshot(reset);
  }, [applySettingsSnapshot]);

  const handleOpenConfigDir = useCallback(async () => {
    await systemApi.openConfigDir();
  }, []);

  const handleExportConfig = useCallback(async () => {
    await systemApi.exportConfig();
  }, []);

  const handleImportConfig = useCallback(async () => {
    const imported = await systemApi.importConfig();
    if (!imported) return;
    await applySettingsSnapshot(imported);
  }, [applySettingsSnapshot]);

  const handleClearHistory = useCallback(async () => {
    const deletedCount = await fileApi.deleteAll();
    if (deletedCount <= 0) return;
    setFiles([]);
    selectFile(null);
    setFileContent(null);
  }, [setFiles, selectFile, setFileContent]);

  const handleConfirmDangerAction = useCallback(async () => {
    const action = dangerAction;
    setDangerAction(null);
    if (action === 'reset') await handleResetSettings();
    else if (action === 'clear-history') await handleClearHistory();
  }, [dangerAction, handleResetSettings, handleClearHistory]);

  // ── Determine which category blocks to show ───────────────────────────────────────────────
  const showCategoryBlock = (category: 'general' | 'ai' | 'telegram' | 'system'): string =>
    nav.showCategory(category) ? 'block' : 'none';

  return (
    <Flex flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>

      {/* Left nav rail */}
      <Stack
        gap={0}
        component="nav"
        w={240}
        miw={160}
        bg="var(--mantine-color-default)"
        style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflowY: 'auto', flexShrink: 0 }}
      >
        <Box p="10px 12px 8px" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text tt="uppercase" lts="0.1em" c="dimmed">
            {t('settings.title')}
          </Text>
        </Box>
        <Box p="8px">
          <Stack gap={4}>
            {nav.navCategoryDefs.map((cat) => (
              <NavItem
                key={cat.id}
                icon={cat.icon}
                label={cat.label}
                active={!nav.isSearching && nav.activeCategory === cat.id}
                hasMatch={nav.isSearching && nav.showCategory(cat.id)}
                onClick={() => { nav.setSearchQuery(''); nav.setActiveCategory(cat.id); }}
              />
            ))}
          </Stack>
        </Box>
      </Stack>

      {/* Main content area */}
      <Box flex={1} p="24px 20px 40px" style={{ overflowY: 'auto' }}>
        <Box maw={560} mx="auto">

          {/* Page title */}
          <Title
            order={2}
            mb={20}
            fz="var(--font-size-3xl)"
            fw={700}
            lts="-0.01em"
            c="var(--mantine-color-default-color)"
          >
            <Group gap={8} align="center">
              <SlidersHorizontal size={17} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
              {t('settings.title')}
            </Group>
          </Title>

          {/* Search bar */}
          <Box pos="relative" mb={20}>
            <TextInput
              value={nav.searchQuery}
              onChange={(e) => nav.setSearchQuery(e.target.value)}
              placeholder={t('settings.search.placeholder')}
              leftSection={<Search size={14} />}
              rightSection={nav.searchQuery ? (
                <ActionIcon variant="subtle" size={28} onClick={() => nav.setSearchQuery('')}>
                  <X size={13} />
                </ActionIcon>
              ) : undefined}
              styles={{
                input: {
                  background: 'var(--mantine-color-default)',
                  borderColor: 'var(--mantine-color-default-border)',
                  color: 'var(--mantine-color-default-color)',
                  fontSize: 'var(--font-size-md)',
                },
              }}
            />
          </Box>

          {/* General settings */}
          <Box display={showCategoryBlock('general')}>
            <GeneralSection
              hotkey={hotkey}
              system={system}
              t={t}
              locale={locale}
              availableLocales={availableLocales}
              onSetLocale={setLocale}
              getLocaleLabel={getLocaleLabel}
              theme={theme}
              onSetTheme={(v) => setTheme(v as Theme)}
              showSection={(tags) => nav.showSection(tags, 'general')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          {/* AI settings */}
          <Box display={showCategoryBlock('ai')}>
            <AiSection
              system={system}
              prefs={prefs}
              t={t}
              locale={locale}
              showSection={(tags) => nav.showSection(tags, 'ai')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          {/* Telegram settings */}
          <Box display={showCategoryBlock('telegram')}>
            <TelegramSection
              telegram={telegram}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'telegram')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          {/* System settings */}
          <Box display={showCategoryBlock('system')}>
            <SystemSection
              dangerAction={dangerAction}
              setDangerAction={setDangerAction}
              onConfirmDangerAction={handleConfirmDangerAction}
              onOpenConfigDir={handleOpenConfigDir}
              onExportConfig={handleExportConfig}
              onImportConfig={handleImportConfig}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'system')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          {/* No search results */}
          {nav.isSearching && !(['general', 'ai', 'telegram', 'system'] as const).some((c) => nav.showCategory(c)) && (
            <Stack align="center" py={48} px={20} c="dimmed">
              <Search size={32} opacity={0.25} />
              <Text fz="var(--font-size-md)">{t('settings.search.empty')}</Text>
            </Stack>
          )}
        </Box>
      </Box>
    </Flex>
  );
};
