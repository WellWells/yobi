import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Flex, Stack } from '@mantine/core';

import { Search } from 'lucide-react';
import { PanelToolbar, ToolbarSearchInput } from '../components/PanelToolbar';
import { EmptyState } from '../components/EmptyState';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { useShortcutStore } from '../store/shortcutStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { useFlowStore } from '../store/useFlowStore';
import { useThemeStore, resolveThemePreference } from '../store/themeStore';
import { settingsApi, fileApi, systemApi } from '../api/electronApi';
import { SECRET_SCOPE_META } from '../../../shared/types';
import type { BackupImportResult, SettingsSnapshot } from '../../../shared/types';

import { GroupHeader, NavItem } from './settings/components';
import { useHotkeyRecorder } from './settings/hooks/useHotkeyRecorder';
import { useQuickExportRecorder } from './settings/hooks/useQuickExportRecorder';
import { useExportPreferences } from './settings/hooks/useExportPreferences';
import { useShareSettings } from './settings/hooks/useShareSettings';
import { useMetrics } from './settings/hooks/useMetrics';
import { usePromptPrefs } from './settings/hooks/usePromptPrefs';
import { useSystemSettings } from './settings/hooks/useSystemSettings';
import { useTelegramSettings } from './settings/hooks/useTelegramSettings';
import { useLineSettings } from './settings/hooks/useLineSettings';
import { useBotCommands } from './settings/hooks/useBotCommands';
import { useAccountSettings } from './settings/hooks/useAccountSettings';
import { useByokSettings } from './settings/hooks/useByokSettings';
import { useByokGroups } from './settings/hooks/useByokGroups';
import { useMcpServers } from './settings/hooks/useMcpServers';
import { useSettingsNav } from './settings/hooks/useSettingsNav';
import type { Category } from './settings/hooks/useSettingsNav';
import { GeneralSection } from './settings/sections/GeneralSection';
import { ShortcutsSection } from './settings/sections/ShortcutsSection';
import { AppearanceSection } from './settings/sections/AppearanceSection';
import { ExportSection } from './settings/sections/ExportSection';
import { NotificationsSection } from './settings/sections/NotificationsSection';
import { AiSection } from './settings/sections/AiSection';
import { ModelSourcesSection } from './settings/sections/ModelSourcesSection';
import { ByokSection } from './settings/sections/ByokSection';
import { McpSection } from './settings/sections/McpSection';
import { BotCommandsSection } from './settings/sections/BotCommandsSection';
import { TelegramSection } from './settings/sections/TelegramSection';
import { LineSection } from './settings/sections/LineSection';
import { StatsSection } from './settings/sections/StatsSection';
import { SystemSection } from './settings/sections/SystemSection';
import type { DangerAction } from './settings/sections/SystemSection';

const SECTION_GAP = 12;

export const SettingsView: React.FC = () => {
  const { t, locale, setLocale, availableLocales, localeTranslations, refreshLocales } = useI18nStore();
  const { setFiles, selectFile, setFileContent } = useAppStore(
    useShallow((s) => ({
      setFiles: s.setFiles,
      selectFile: s.selectFile,
      setFileContent: s.setFileContent,
    })),
  );
  const setTheme = useThemeStore((s) => s.setTheme);

  const hotkey = useHotkeyRecorder();
  const quickExport = useQuickExportRecorder();
  const exportPreferences = useExportPreferences();
  const shareSettings = useShareSettings();
  const prefs = usePromptPrefs();
  const system = useSystemSettings();
  const metrics = useMetrics();
  const telegram = useTelegramSettings();
  const line = useLineSettings();
  const botCommands = useBotCommands();
  const account = useAccountSettings();
  const byok = useByokSettings();
  const byokGroups = useByokGroups(byok.snapshot, byok.applySnapshot);
  const mcp = useMcpServers();
  const nav = useSettingsNav();
  // Only the scopes that live in this view light up a nav entry; SMTP and data keys are
  // configured inside flow steps, so their alerts belong there instead.
  const secretScopes = useSecretHealthStore(useShallow((s) => s.failures.map((failure) => failure.scope)));
  const alertCategories = useMemo(
    () => new Set<string>(secretScopes.map((scope) => SECRET_SCOPE_META[scope].category)),
    [secretScopes],
  );

  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
  const applySettingsSnapshot = useCallback(async (snapshot: SettingsSnapshot) => {
    hotkey.applyHotkeyReset(snapshot.hotkey, snapshot.hotkeyEnabled);
    useShortcutStore.getState().setOverrides(snapshot.shortcuts ?? {});
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

  const getLocaleLabel = useCallback((localeCode: string): string => {
    const selfName = localeTranslations[localeCode]?.['language.name.self'];
    return typeof selfName === 'string' && selfName.trim() ? selfName : localeCode;
  }, [localeTranslations]);

  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const selectFlow = useFlowStore((s) => s.selectFlow);

  const handleOpenFlow = useCallback((flowId: string) => {
    selectFlow(flowId);
    setView('flow');
  }, [selectFlow, setView]);
  useEffect(() => {
    if (currentView === 'settings') void refreshLocales();
  }, [currentView, refreshLocales]);

  const handleOpenLanguagesFolder = useCallback(async (): Promise<void> => {
    await settingsApi.openLanguagesFolder();
    await refreshLocales();
  }, [refreshLocales]);

  const handleResetSettings = useCallback(async () => {
    await settingsApi.resetSettings();
  }, []);

  const handleOpenConfigDir = useCallback(async () => {
    await systemApi.openConfigDir();
  }, []);

  const handleBackupRestored = useCallback(async (result: BackupImportResult) => {
    if (result.snapshot) await applySettingsSnapshot(result.snapshot);
    if (result.restored.includes('flows')) {
      await useFlowStore.getState().loadFlows();
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

  const categoryBlock = (category: Category, content: React.ReactNode): React.ReactNode => (
    <Box display={nav.showCategory(category) ? 'block' : 'none'}>
      {nav.isSearching && <GroupHeader label={t(`settings.group.${category}`)} />}
      {content}
    </Box>
  );

  const anyBotEnabled = (telegram.telegramSettings?.enabled ?? false) || (line.lineSettings?.enabled ?? false);

  return (
    <Flex flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>

      <Stack
        gap={0}
        component="nav"
        w={240}
        miw={160}
        bg="var(--mantine-color-default)"
        style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden', flexShrink: 0 }}
      >
        <PanelToolbar>
          <ToolbarSearchInput
            ref={nav.searchInputRef}
            value={nav.searchQuery}
            onChange={nav.setSearchQuery}
            placeholder={t('settings.search.placeholder')}
            clearLabel={t('settings.search.clear')}
          />
        </PanelToolbar>
        {
}
        <Box px="8px" py="8px" flex={1} style={{ overflowY: 'auto', minHeight: 0 }}>
          <Stack gap={4}>
            {nav.navCategoryDefs.map((cat) => (
              <NavItem
                key={cat.id}
                icon={cat.icon}
                label={cat.label}
                active={!nav.isSearching && nav.activeCategory === cat.id}
                hasMatch={nav.isSearching && nav.showCategory(cat.id)}
                alert={alertCategories.has(cat.id)}
                onClick={() => { nav.setSearchQuery(''); nav.setActiveCategory(cat.id); }}
              />
            ))}
          </Stack>
        </Box>
      </Stack>

      <Box flex={1} p="24px 20px 40px" style={{ overflowY: 'auto' }}>
        <Box maw={560} mx="auto">
          {categoryBlock('general', (
            <>
              <GeneralSection
                system={system}
                t={t}
                locale={locale}
                availableLocales={availableLocales}
                onSetLocale={setLocale}
                getLocaleLabel={getLocaleLabel}
                onOpenLanguagesFolder={handleOpenLanguagesFolder}
                onOpenShortcuts={() => nav.setActiveCategory('shortcuts')}
                showSection={(tags) => nav.showSection(tags, 'general')}
                sectionGap={SECTION_GAP}
              />
              <NotificationsSection
                system={system}
                t={t}
                showSection={(tags) => nav.showSection(tags, 'general')}
                sectionGap={SECTION_GAP}
              />
            </>
          ))}

          {categoryBlock('shortcuts', (
            <ShortcutsSection
              hotkey={hotkey}
              quickExport={quickExport}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'shortcuts')}
              sectionGap={SECTION_GAP}
              onOpenFlow={handleOpenFlow}
            />
          ))}

          {categoryBlock('appearance', (
            <AppearanceSection
              t={t}
              showSection={(tags) => nav.showSection(tags, 'appearance')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('export', (
            <ExportSection
              quickExport={quickExport}
              preferences={exportPreferences}
              share={shareSettings}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'export')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('ai', (
            <AiSection
              system={system}
              prefs={prefs}
              t={t}
              locale={locale}
              showSection={(tags) => nav.showSection(tags, 'ai')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('connectors', (
            <McpSection
              mcp={mcp}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'connectors')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('accounts', (
            <>
              <ModelSourcesSection
                account={account}
                t={t}
                showSection={(tags) => nav.showSection(tags, 'accounts')}
                sectionGap={SECTION_GAP}
              />
              <ByokSection
                byok={byok}
                byokGroups={byokGroups}
                t={t}
                showSection={(tags) => nav.showSection(tags, 'accounts')}
                sectionGap={SECTION_GAP}
              />
            </>
          ))}

          {categoryBlock('bots', (
            <>
              <BotCommandsSection
                botCommands={botCommands}
                anyBotEnabled={anyBotEnabled}
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
            </>
          ))}

          {categoryBlock('stats', (
            <StatsSection
              metrics={metrics}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'stats')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('system', (
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
          ))}

          {nav.isSearching && !nav.navCategoryDefs.some((cat) => nav.showCategory(cat.id)) && (
            <EmptyState icon={Search} label={t('settings.search.empty')} />
          )}
        </Box>
      </Box>
    </Flex>
  );
};
