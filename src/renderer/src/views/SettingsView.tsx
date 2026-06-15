import React, { useCallback, useState } from 'react';
import { ActionIcon, Box, Flex, Stack, Text } from '@mantine/core';

import { Search, X } from 'lucide-react';
import { AppTextInput } from '../components/AppTextInput';
import { useShallow } from 'zustand/react/shallow';
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
import { useAccountSettings } from './settings/hooks/useAccountSettings';
import { useSettingsNav } from './settings/hooks/useSettingsNav';
import { GeneralSection } from './settings/sections/GeneralSection';
import { AiSection } from './settings/sections/AiSection';
import { AccountsSection } from './settings/sections/AccountsSection';
import { TelegramSection } from './settings/sections/TelegramSection';
import { SystemSection } from './settings/sections/SystemSection';
import type { DangerAction } from './settings/sections/SystemSection';

const SECTION_GAP = 12;

export const SettingsView: React.FC = () => {
  const { t, locale, setLocale, availableLocales } = useI18nStore();
  const { setFiles, selectFile, setFileContent } = useAppStore(
    useShallow((s) => ({
      setFiles: s.setFiles,
      selectFile: s.selectFile,
      setFileContent: s.setFileContent,
    })),
  );
  const { theme, setTheme } = useThemeStore();

  const hotkey = useHotkeyRecorder();
  const prefs = usePromptPrefs();
  const system = useSystemSettings();
  const telegram = useTelegramSettings();
  const account = useAccountSettings();
  const nav = useSettingsNav();

  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
  const applySettingsSnapshot = useCallback(async (snapshot: SettingsSnapshot) => {
    hotkey.applyHotkeyReset(snapshot.hotkey);
    prefs.applyPromptReset(snapshot.promptPreferences, snapshot.syncSystemLanguageToModel, snapshot.youtubePrompt);
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

  const showCategoryBlock = (category: 'general' | 'ai' | 'accounts' | 'bots' | 'system'): string =>
    nav.showCategory(category) ? 'block' : 'none';

  return (
    <Flex flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>

      <Stack
        gap={0}
        component="nav"
        w={240}
        miw={160}
        bg="var(--mantine-color-default)"
        style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflowY: 'auto', flexShrink: 0 }}
      >
        <Box px="10px" pt="10px" pb="6px">
          <AppTextInput
            value={nav.searchQuery}
            onChange={(e) => nav.setSearchQuery(e.target.value)}
            placeholder={t('settings.search.placeholder')}
            tone="tertiary"
            variant="default"
            size="xs"
            radius="sm"
            leftSection={<Search size={13} />}
            rightSection={nav.searchQuery ? (
              <ActionIcon variant="subtle" size={20} onClick={() => nav.setSearchQuery('')} aria-label={t('settings.search.clear')}>
                <X size={12} />
              </ActionIcon>
            ) : undefined}
          />
        </Box>
        <Box px="8px" pb="8px">
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

      <Box flex={1} p="24px 20px 40px" style={{ overflowY: 'auto' }}>
        <Box maw={560} mx="auto">
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

          <Box display={showCategoryBlock('accounts')}>
            <AccountsSection
              account={account}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'accounts')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          <Box display={showCategoryBlock('bots')}>
            <TelegramSection
              telegram={telegram}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'bots')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

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

          {nav.isSearching && !(['general', 'ai', 'accounts', 'bots', 'system'] as const).some((c) => nav.showCategory(c)) && (
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
