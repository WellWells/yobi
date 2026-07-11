import React, { useCallback, useState } from 'react';
import { ActionIcon, Box, Flex, Stack, Text } from '@mantine/core';

import { Search, X } from 'lucide-react';
import { AppTextInput } from '../components/AppTextInput';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { useAgentFlowStore } from '../store/useAgentFlowStore';
import { useThemeStore, resolveThemePreference } from '../store/themeStore';
import { settingsApi, fileApi, systemApi } from '../api/electronApi';
import type { BackupImportResult, SettingsSnapshot } from '../../../shared/types';

import { NavItem } from './settings/components';
import { useHotkeyRecorder } from './settings/hooks/useHotkeyRecorder';
import { useMetrics } from './settings/hooks/useMetrics';
import { usePromptPrefs } from './settings/hooks/usePromptPrefs';
import { useSystemSettings } from './settings/hooks/useSystemSettings';
import { useTelegramSettings } from './settings/hooks/useTelegramSettings';
import { useLineSettings } from './settings/hooks/useLineSettings';
import { useBotCommands } from './settings/hooks/useBotCommands';
import { useAccountSettings } from './settings/hooks/useAccountSettings';
import { useByokSettings } from './settings/hooks/useByokSettings';
import { useByokGroups } from './settings/hooks/useByokGroups';
import { useSettingsNav } from './settings/hooks/useSettingsNav';
import { GeneralSection } from './settings/sections/GeneralSection';
import { AppearanceSection } from './settings/sections/AppearanceSection';
import { NotificationsSection } from './settings/sections/NotificationsSection';
import { AiSection } from './settings/sections/AiSection';
import { ModelSourcesSection } from './settings/sections/ModelSourcesSection';
import { ByokSection } from './settings/sections/ByokSection';
import { BotCommandsSection } from './settings/sections/BotCommandsSection';
import { TelegramSection } from './settings/sections/TelegramSection';
import { LineSection } from './settings/sections/LineSection';
import { StatsSection } from './settings/sections/StatsSection';
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
  const setTheme = useThemeStore((s) => s.setTheme);

  const hotkey = useHotkeyRecorder();
  const prefs = usePromptPrefs();
  const system = useSystemSettings();
  const metrics = useMetrics();
  const telegram = useTelegramSettings();
  const line = useLineSettings();
  const botCommands = useBotCommands();
  const account = useAccountSettings();
  const byok = useByokSettings();
  const byokGroups = useByokGroups(byok.snapshot, byok.applySnapshot);
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
      snapshot.notifyEvents,
    );
    metrics.applyMetricsReset(snapshot.metricsEnabled);
    setTheme(resolveThemePreference(snapshot.theme));
    await setLocale(snapshot.locale);
    await telegram.loadTelegramSettings();
    await line.loadLineSettings();
    await botCommands.loadBotCommands();
    await byok.reload();
  }, [hotkey, prefs, system, metrics, telegram, line, botCommands, byok, setTheme, setLocale]);

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
    await settingsApi.resetSettings();
  }, []);

  const handleOpenConfigDir = useCallback(async () => {
    await systemApi.openConfigDir();
  }, []);

  const handleBackupRestored = useCallback(async (result: BackupImportResult) => {
    if (result.snapshot) await applySettingsSnapshot(result.snapshot);
    if (result.restored.includes('flows')) {
      await useAgentFlowStore.getState().loadFlows();
    }
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

  const showCategoryBlock = (category: 'general' | 'appearance' | 'notify' | 'ai' | 'accounts' | 'bots' | 'stats' | 'system'): string =>
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
              showSection={(tags) => nav.showSection(tags, 'general')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          <Box display={showCategoryBlock('appearance')}>
            <AppearanceSection
              t={t}
              showSection={(tags) => nav.showSection(tags, 'appearance')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          <Box display={showCategoryBlock('notify')}>
            <NotificationsSection
              system={system}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'notify')}
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
            <ModelSourcesSection
              account={account}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'accounts')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
            <ByokSection
              byok={byok}
              byokGroups={byokGroups}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'accounts')}
              sectionGap={SECTION_GAP}
            />
          </Box>

          <Box display={showCategoryBlock('bots')}>
            <BotCommandsSection
              botCommands={botCommands}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'bots')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
            <TelegramSection
              telegram={telegram}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'bots')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
            <LineSection
              line={line}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'bots')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          <Box display={showCategoryBlock('stats')}>
            <StatsSection
              metrics={metrics}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'stats')}
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
              onBackupRestored={handleBackupRestored}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'system')}
              isSearching={nav.isSearching}
              sectionGap={SECTION_GAP}
            />
          </Box>

          {nav.isSearching && !(['general', 'appearance', 'notify', 'ai', 'accounts', 'bots', 'stats', 'system'] as const).some((c) => nav.showCategory(c)) && (
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
