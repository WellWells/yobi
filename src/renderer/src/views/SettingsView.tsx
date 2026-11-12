import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Divider, Flex, Stack, Title } from '@mantine/core';

import { Info, ScrollText, Search } from 'lucide-react';
import { PanelToolbar, ToolbarSearchInput } from '../components/PanelToolbar';
import { useWidthBelow } from '../hooks/useWidthBelow';
import { SettingsTabStrip } from './settings/SettingsTabStrip';
import { LogPanel } from '../components/LogPanel';
import { AboutView } from './AboutView';
import { useUpdateStore } from '../store/useUpdateStore';
import { EmptyState } from '../components/EmptyState';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../store/i18nStore';
import { isMainView, useAppStore } from '../store/appStore';
import { applyShortcutSnapshot } from '../shortcuts/applyShortcutSnapshot';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { useFlowStore } from '../store/useFlowStore';
import { useThemeStore, resolveThemePreference } from '../store/themeStore';
import { initReadingFromConfig } from '../store/readingStore';
import { initSidebarViewFromConfig } from '../store/sidebarViewStore';
import { initLinkRecognitionFromConfig } from '../store/linkRecognitionStore';
import { settingsApi, fileApi, systemApi } from '../api/electronApi';
import { initChatDisplayFromConfig } from '../hooks/useAppBootstrap';
import { SECRET_SCOPE_META } from '../../../shared/types';
import type { BackupImportResult, SettingsSnapshot } from '../../../shared/types';

import { GroupHeader, NavItem } from './settings/components';
import { FreezeWhileHidden } from './settings/FreezeWhileHidden';
import { useHotkeyRecorder, useRegionHotkeyRecorder } from './settings/hooks/useHotkeyRecorder';
import { useQuickExportRecorder } from './settings/hooks/useQuickExportRecorder';
import { useExportPreferences } from './settings/hooks/useExportPreferences';
import { useShareSettings } from './settings/hooks/useShareSettings';
import { useMetrics } from './settings/hooks/useMetrics';
import { usePromptPrefs } from './settings/hooks/usePromptPrefs';
import { useLinkAnalysisPreferences } from './settings/hooks/useLinkAnalysisPreferences';
import { useSystemSettings } from './settings/hooks/useSystemSettings';
import { useTelegramSettings } from './settings/hooks/useTelegramSettings';
import { useLineSettings } from './settings/hooks/useLineSettings';
import { useBotCommands } from './settings/hooks/useBotCommands';
import { useAccountSettings } from './settings/hooks/useAccountSettings';
import { useByokSettings } from './settings/hooks/useByokSettings';
import { useByokGroups } from './settings/hooks/useByokGroups';
import { useMcpServers } from './settings/hooks/useMcpServers';
import { useUserMemory } from './settings/hooks/useUserMemory';
import { useBotAccess } from './settings/hooks/useBotAccess';
import { MemorySection } from './settings/sections/MemorySection';
import { TAG_SETS, useSettingsNav } from './settings/hooks/useSettingsNav';
import type { Category } from './settings/hooks/useSettingsNav';
import { GeneralSection } from './settings/sections/GeneralSection';
import { ShortcutsSection } from './settings/sections/ShortcutsSection';
import { AppearanceSection } from './settings/sections/AppearanceSection';
import { ExportSection } from './settings/sections/ExportSection';
import { NotificationsSection } from './settings/sections/NotificationsSection';
import { AiSection } from './settings/sections/AiSection';
import { ModelSourcesSection } from './settings/sections/ModelSourcesSection';
import { AnalysisModelSettings } from './settings/sections/AnalysisModelSettings';
import { MapsPromptSetting } from './settings/sections/MapsPromptSetting';
import { ByokSection } from './settings/sections/ByokSection';
import { McpSection } from './settings/sections/McpSection';
import { SkillsSection } from './settings/sections/skills/SkillsSection';
import { BotCommandsSection } from './settings/sections/BotCommandsSection';
import { TelegramSection } from './settings/sections/TelegramSection';
import { LineSection } from './settings/sections/LineSection';
import { SocketBotSection } from './settings/sections/SocketBotSection';
import { useSocketBotSettings } from './settings/hooks/useSocketBotSettings';
import { anyBotEnabled as anyRosterBotEnabled } from './settings/sections/botPermissionsView';
import { StatsSection } from './settings/sections/StatsSection';
import { SystemSection } from './settings/sections/SystemSection';
import { LinkRecognitionSetting } from './settings/sections/LinkRecognitionSetting';
import { YtdlToolsSetting } from './settings/sections/YtdlToolsSetting';
import type { DangerAction } from './settings/sections/SystemSection';

const SECTION_GAP = 12;

/**
 * Below this width of Settings itself the nav is a row of tabs above the page, as Claude's
 * settings on a narrow window: beside a 240px nav the column would be under ~480px.
 */
export const SETTINGS_NAV_COMPACT_BELOW = 760;

export const SettingsView: React.FC = () => {
  const { t, locale, setLocale, availableLocales, localeTranslations, refreshLocales } = useI18nStore(
    useShallow((s) => ({
      t: s.t,
      locale: s.locale,
      setLocale: s.setLocale,
      availableLocales: s.availableLocales,
      localeTranslations: s.localeTranslations,
      refreshLocales: s.refreshLocales,
    })),
  );
  const { setFiles, selectFile, setFileContent } = useAppStore(
    useShallow((s) => ({
      setFiles: s.setFiles,
      selectFile: s.selectFile,
      setFileContent: s.setFileContent,
    })),
  );
  const setTheme = useThemeStore((s) => s.setTheme);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);

  const hotkey = useHotkeyRecorder();
  const quickExport = useQuickExportRecorder();
  const regionHotkey = useRegionHotkeyRecorder();
  const exportPreferences = useExportPreferences();
  const shareSettings = useShareSettings();
  const prefs = usePromptPrefs();
  const analysis = useLinkAnalysisPreferences();
  const system = useSystemSettings();
  const metrics = useMetrics();
  const telegram = useTelegramSettings();
  const line = useLineSettings();
  const botCommands = useBotCommands();
  const account = useAccountSettings();
  const { applyOneShotTemporaryChatReset, applyProviderFallbackReset } = account;
  const byok = useByokSettings();
  const byokGroups = useByokGroups(byok.snapshot, byok.applySnapshot);
  const mcp = useMcpServers();
  const userMemory = useUserMemory();
  const discord = useSocketBotSettings('discord');
  const slack = useSocketBotSettings('slack');
  const lineSelf = useSocketBotSettings('lineSelf');
  const botAccess = useBotAccess({ telegram, line, discord, slack, lineSelf, memory: userMemory, mcp, t });
  const nav = useSettingsNav();
  // Logs and About are pages of Settings (Alt+3, Alt+5, an error notice's 查看日誌 and the update
  // notice open them): the nav stays beside them.
  const page = useAppStore((s) => (s.currentView === 'logs' || s.currentView === 'about' ? s.currentView : 'settings'));
  // Whether the dialog is open, not which view is behind it: switching chat and flow must not
  // redraw Settings.
  const open = useAppStore((s) => !isMainView(s.currentView));
  const onSettingsPage = open && page === 'settings';

  // Back to the top when the category changes: the view never unmounts, so any entry point would
  // land at the previous offset. Keyed on `isSearching`, not the query, or it scrolls per keystroke.
  const contentRef = useRef<HTMLDivElement>(null);
  // The nav becomes a row of tabs when the dialog itself is narrow — its own width, not the
  // window's: the column keeps room to read.
  const [rootRef, compactNav] = useWidthBelow(SETTINGS_NAV_COMPACT_BELOW);
  useLayoutEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [nav.activeCategory, nav.isSearching]);

  // Only the scopes that live in this view light up a nav entry; SMTP and data keys are
  // configured inside flow steps, so their alerts belong there instead.
  const secretScopes = useSecretHealthStore(useShallow((s) => s.failures.map((failure) => failure.scope)));
  const alertCategories = useMemo(
    () => new Set<string>(secretScopes.map((scope) => SECRET_SCOPE_META[scope].category)),
    [secretScopes],
  );

  const [dangerAction, setDangerAction] = useState<DangerAction>(null);
  const applySettingsSnapshot = useCallback(async (snapshot: SettingsSnapshot) => {
    await applyShortcutSnapshot(snapshot);
    prefs.applyPromptReset(snapshot.promptPreferences, snapshot.syncSystemLanguageToModel, snapshot.youtubePrompt);
    analysis.applyReset(snapshot.linkAnalysis);
    system.applySystemReset(
      snapshot.notifyOnComplete,
      snapshot.responseTimeout,
      snapshot.closeToTray,
      snapshot.launchAtStartup,
      snapshot.notifyEvents,
    );
    metrics.applyMetricsReset(snapshot.metricsEnabled);
    applyOneShotTemporaryChatReset(snapshot.oneShotTemporaryChat);
    applyProviderFallbackReset(snapshot.providerFallback);
    setTheme(resolveThemePreference(snapshot.theme));
    // Reading prefs are not in the snapshot: re-read them so the store, mirror and root attributes follow the restored config.
    initReadingFromConfig();
    initSidebarViewFromConfig();
    initChatDisplayFromConfig();
    // The restored config already holds the language and whether the user picked it: applying it
    // must not mark it user-picked, or an auto-detected zh-TW would make the user a Taiwan user.
    await setLocale(snapshot.locale, { persist: false });
    await window.electronAPI.setLocaleAuto(snapshot.locale);
    // After the language: the link switches' defaults follow it.
    initLinkRecognitionFromConfig();
    await telegram.loadTelegramSettings();
    await line.loadLineSettings();
    await botCommands.loadBotCommands();
    await byok.reload();
  }, [prefs, analysis, system, metrics, applyOneShotTemporaryChatReset, applyProviderFallbackReset, telegram, line, botCommands, byok, setTheme, setLocale]);

  const getLocaleLabel = useCallback((localeCode: string): string => {
    const selfName = localeTranslations[localeCode]?.['language.name.self'];
    return typeof selfName === 'string' && selfName.trim() ? selfName : localeCode;
  }, [localeTranslations]);

  const setView = useAppStore((s) => s.setView);
  const selectFlow = useFlowStore((s) => s.selectFlow);

  const handleOpenFlow = useCallback((flowId: string) => {
    selectFlow(flowId);
    setView('flow');
  }, [selectFlow, setView]);
  useEffect(() => {
    if (onSettingsPage) void refreshLocales();
  }, [onSettingsPage, refreshLocales]);

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

  // Every category stays mounted; the ones not on screen keep what they drew last.
  const categoryBlock = (category: Category, content: React.ReactNode): React.ReactNode => {
    const shown = nav.showCategory(category);
    return (
      <Box display={shown ? 'block' : 'none'}>
        {nav.isSearching && <GroupHeader label={t(`settings.group.${category}`)} />}
        <FreezeWhileHidden shown={onSettingsPage && shown} pending={nav.searchPending}>{content}</FreezeWhileHidden>
      </Box>
    );
  };

  const anyBotEnabled = anyRosterBotEnabled(botAccess.roster);

  /* The dialog opens on the search, as Claude's: typing finds a setting. Atop the nav, or atop
     the row of tabs. */
  const searchInput = (
    <ToolbarSearchInput
      dialogFocus
      ref={nav.searchInputRef}
      value={nav.searchQuery}
      onChange={(query) => {
        nav.setSearchQuery(query);
        // Results are settings: searching from Logs or About shows them.
        if (query && page !== 'settings') setView('settings');
      }}
      placeholder={t('settings.search.placeholder')}
      clearLabel={t('settings.search.clear')}
    />
  );

  /* The same entries either way: a column of rows beside the page, or a row of tabs above it. */
  const navEntries = (
    <>
      {nav.navCategoryDefs.map((cat) => (
        <NavItem
          key={cat.id}
          icon={cat.icon}
          label={cat.label}
          active={page === 'settings' && !nav.isSearching && nav.activeCategory === cat.id}
          hasMatch={nav.isSearching && nav.showCategory(cat.id)}
          alert={alertCategories.has(cat.id)}
          tab={compactNav}
          onClick={() => { nav.setSearchQuery(''); nav.setActiveCategory(cat.id); setView('settings'); }}
        />
      ))}
      {/* Not settings categories but the app's own pages, shown in the same pane. */}
      {compactNav ? <Divider orientation="vertical" my={6} mx={4} /> : <Divider my={4} />}
      <NavItem
        icon={<ScrollText size={14} />}
        label={t('nav.logs')}
        active={page === 'logs'}
        hasMatch={false}
        tab={compactNav}
        onClick={() => { nav.setSearchQuery(''); setView('logs'); }}
      />
      <NavItem
        icon={<Info size={14} />}
        label={t('nav.about')}
        active={page === 'about'}
        hasMatch={false}
        notice={hasUpdate}
        tab={compactNav}
        onClick={() => { nav.setSearchQuery(''); setView('about'); }}
      />
    </>
  );

  return (
    <Flex ref={rootRef} flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>

      {!compactNav && (
        <Stack
          gap={0}
          component="nav"
          w={240}
          miw={160}
          bg="var(--mantine-color-default)"
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden', flexShrink: 0 }}
        >
          {/* No bottom border: the pane beside it has none either, so the rule would stop dead at
              the divider. No way back: the dialog's ✕ and Escape close Settings. */}
          <PanelToolbar withBottomBorder={false}>{searchInput}</PanelToolbar>
          <Box px="8px" py="8px" flex={1} style={{ overflowY: 'auto', minHeight: 0 }}>
            <Stack gap={4}>{navEntries}</Stack>
          </Box>
        </Stack>
      )}

      <Stack flex={1} gap={0} miw={0} style={{ overflow: 'hidden' }}>
      {compactNav && (
        <>
          <PanelToolbar withBottomBorder={false}>{searchInput}</PanelToolbar>
          <SettingsTabStrip activeKey={page === 'settings' ? (nav.isSearching ? '' : nav.activeCategory) : page}>
            {navEntries}
          </SettingsTabStrip>
        </>
      )}
      {/* All three stay mounted, as the views do: opening Logs or About must not rebuild every
          section, and the log keeps its filter and place. */}
      <Flex display={page === 'logs' ? 'flex' : 'none'} direction="column" flex={1} mih={0}>
        <LogPanel />
      </Flex>
      <Flex display={page === 'about' ? 'flex' : 'none'} flex={1} mih={0}>
        <AboutView />
      </Flex>
      {/* The scrollbar's lane is kept even on pages too short to scroll, so the centred column does
          not shift sideways when switching between a short page and a long one. The 8px top puts
          the page title level with the first nav row. */}
      <Box
        display={page === 'settings' ? 'block' : 'none'}
        flex={1}
        mih={0}
        ref={contentRef}
        p="8px 20px 40px"
        style={{ overflowY: 'auto', scrollbarGutter: 'stable' }}
      >
        {/* Blocks follow CATEGORY_IDS (the nav order): multi-category search results stack this way. */}
        {/* 720px, the width ChatGPT's and Claude's settings give their content: wide enough for
            two connector tiles side by side, and the same on every page so nothing jumps. */}
        <Box maw={720} mx="auto">
          {/* The page names itself, like every big app's settings; search results carry a header per category instead. */}
          {!nav.isSearching && (
            <Title order={1} fz="var(--font-size-3xl)" fw={700} c="var(--mantine-color-text)" mb={16}>
              {t(`settings.group.${nav.activeCategory}`)}
            </Title>
          )}
          {categoryBlock('accounts', (
            <>
              <AnalysisModelSettings
                analysis={analysis}
                t={t}
                visible={nav.showSection(TAG_SETS.modelDefaults, 'accounts')}
                sectionGap={SECTION_GAP}
              />
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

          {categoryBlock('ai', (
            <AiSection
              system={system}
              prefs={prefs}
              t={t}
              localeLabel={getLocaleLabel(locale)}
              showSection={(tags) => nav.showSection(tags, 'ai')}
              sectionGap={SECTION_GAP}
            >
              <MapsPromptSetting
                analysis={analysis}
                t={t}
                visible={nav.showSection(TAG_SETS.mapsPrompt, 'ai')}
                sectionGap={SECTION_GAP}
              />
            </AiSection>
          ))}

          {categoryBlock('memory', (
            <MemorySection
              memory={userMemory}
              roster={botAccess.roster}
              t={t}
              locale={locale}
              showSection={(tags) => nav.showSection(tags, 'memory')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('connectors', (
            <McpSection
              mcp={mcp}
              roster={botAccess.roster}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'connectors')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('skills', (
            <SkillsSection
              t={t}
              showSection={(tags) => nav.showSection(tags, 'skills')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('bots', (
            <>
              <TelegramSection
                telegram={telegram}
                access={botAccess.telegram}
                botCommands={botCommands}
                t={t}
                showSection={(tags) => nav.showSection(tags, 'bots')}
                isSearching={nav.isSearching}
                sectionGap={SECTION_GAP}
              />
              <LineSection
                line={line}
                access={botAccess.line}
                botCommands={botCommands}
                t={t}
                showSection={(tags) => nav.showSection(tags, 'bots')}
                isSearching={nav.isSearching}
                sectionGap={SECTION_GAP}
              />
              {([lineSelf, discord, slack] as const).map((bot) => (
                <SocketBotSection
                  key={bot.platform}
                  bot={bot}
                  access={botAccess[bot.platform]}
                  botCommands={botCommands}
                  t={t}
                  showSection={(tags) => nav.showSection(tags, 'bots')}
                  isSearching={nav.isSearching}
                  sectionGap={SECTION_GAP}
                />
              ))}
              <BotCommandsSection
                botCommands={botCommands}
                anyBotEnabled={anyBotEnabled}
                roster={botAccess.roster}
                t={t}
                showSection={(tags) => nav.showSection(tags, 'bots')}
                isSearching={nav.isSearching}
                sectionGap={SECTION_GAP}
              />
            </>
          ))}

          {categoryBlock('general', (
            <GeneralSection
              system={system}
              t={t}
              locale={locale}
              availableLocales={availableLocales}
              onSetLocale={setLocale}
              getLocaleLabel={getLocaleLabel}
              onOpenLanguagesFolder={handleOpenLanguagesFolder}
              showSection={(tags) => nav.showSection(tags, 'general')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('appearance', (
            <AppearanceSection
              t={t}
              showSection={(tags) => nav.showSection(tags, 'appearance')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('notifications', (
            <NotificationsSection
              system={system}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'notifications')}
              sectionGap={SECTION_GAP}
            />
          ))}

          {categoryBlock('links', (
            <>
              <LinkRecognitionSetting t={t} visible={nav.showSection(TAG_SETS.links, 'links')} sectionGap={SECTION_GAP} />
              <YtdlToolsSetting t={t} visible={nav.showSection(TAG_SETS.ytdl, 'links')} sectionGap={SECTION_GAP} roster={botAccess.roster} />
            </>
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

          {categoryBlock('shortcuts', (
            <ShortcutsSection
              hotkey={hotkey}
              quickExport={quickExport}
              region={regionHotkey}
              t={t}
              showSection={(tags) => nav.showSection(tags, 'shortcuts')}
              sectionGap={SECTION_GAP}
              onOpenFlow={handleOpenFlow}
            />
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
      </Stack>
    </Flex>
  );
};
