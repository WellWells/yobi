import { useEffect } from 'react';
import { NAV_ORDER, useAppStore } from '../store/appStore';
import { useFlowStore } from '../store/useFlowStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { useMcpStore } from '../store/useMcpStore';
import { useKnowledgeStore } from '../store/useKnowledgeStore';
import { initThemeFromConfig } from '../store/themeStore';
import { initReadingFromConfig } from '../store/readingStore';
import { initSidebarViewFromConfig } from '../store/sidebarViewStore';
import { initLinkRecognitionFromConfig, useLinkRecognitionStore } from '../store/linkRecognitionStore';
import type { LayoutMode } from '../store/appStore';
import { accountApi, byokApi, chatgptModelApi, claudeModelApi, geminiModelApi, ipcEvents, perplexityModelApi, knowledgeApi, mcpApi, settingsApi, tempChatApi } from '../api/electronApi';
import { onIdle } from '../utils/idle';
import { makeByokGroupModels, makeByokModelOption } from '../config/models';
import { useShortcutAction } from '../shortcuts/useShortcutAction';
import { useShortcutStore } from '../store/shortcutStore';
import { useExportSettingsStore } from '../store/exportSettingsStore';

/**
 * The chat's display settings, read from the config: at startup, and again after a backup
 * restore brought back a config (otherwise the recap and token lines keep the old setting).
 */
export function initChatDisplayFromConfig(): void {
  void settingsApi.getLayoutMode().then((mode) => {
    if (mode === 'side-by-side' || mode === 'stacked') {
      useAppStore.setState({ layoutMode: mode as LayoutMode });
    }
  });
  void settingsApi.getMarkdownZoom().then((zoom) => {
    if (typeof zoom === 'number' && Number.isFinite(zoom)) {
      useAppStore.setState({ markdownZoom: zoom });
    }
  });
  void settingsApi.getShowTokenUsage().then((show) => {
    if (typeof show === 'boolean') useAppStore.setState({ showTokenUsage: show });
  });
  void settingsApi.getShowRecap().then((show) => {
    if (typeof show === 'boolean') useAppStore.setState({ showRecap: show });
  });
}

async function loadKnowledgeBases(): Promise<void> {
  const { bases, statuses } = await knowledgeApi.list();
  useKnowledgeStore.getState().setBases(bases);
  useKnowledgeStore.getState().setStatuses(statuses);
}

/**
 * Everything outside the Settings page that holds a setting, read again after the Yobi connector
 * changed settings in main. The Settings page itself is remounted (`App.tsx`), so its hooks re-read.
 */
export async function reloadSettingsFromConfig(): Promise<void> {
  const app = useAppStore.getState();
  initThemeFromConfig();
  initReadingFromConfig();
  initSidebarViewFromConfig();
  initChatDisplayFromConfig();
  initLinkRecognitionFromConfig();
  void useExportSettingsStore.getState().reload();
  void settingsApi.getHotkey().then(app.setHotkey);
  void settingsApi.getRegionHotkey().then(app.setRegionHotkey);
  void settingsApi.getShortcuts().then(useShortcutStore.getState().setOverrides);
  void settingsApi.getPromptPreferences().then((prefs) => app.setUserNickname(prefs.nickname ?? ''));
  void settingsApi.getHiddenSources().then(app.setHiddenSources);
  void mcpApi.list().then(useMcpStore.getState().setServers);
  void loadKnowledgeBases();
  const { locale } = await window.electronAPI.getCurrentLocale();
  const i18n = useI18nStore.getState();
  if (locale && locale !== i18n.locale) await i18n.setLocale(locale, { persist: false });
}

export function useAppBootstrap() {
  const appendLog = useAppStore((s) => s.appendLog);
  const setStatus = useAppStore((s) => s.setStatus);
  const setQueue = useAppStore((s) => s.setQueue);
  const setAccountStatuses = useAppStore((s) => s.setAccountStatuses);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const setView = useAppStore((s) => s.setView);
  const hydrateAiUrl = useAppStore((s) => s.hydrateAiUrl);
  const setByokModels = useAppStore((s) => s.setByokModels);
  const setByokGroupModels = useAppStore((s) => s.setByokGroupModels);
  const setHiddenSources = useAppStore((s) => s.setHiddenSources);
  const setGeminiModels = useAppStore((s) => s.setGeminiModels);
  const setClaudeModels = useAppStore((s) => s.setClaudeModels);
  const setChatgptModels = useAppStore((s) => s.setChatgptModels);
  const setPerplexityModels = useAppStore((s) => s.setPerplexityModels);
  const setTempChatMode = useAppStore((s) => s.setTempChatMode);
  const setTempChatResult = useAppStore((s) => s.setTempChatResult);
  const loadLocales = useI18nStore((s) => s.loadLocales);
  const initializeListeners = useUpdateStore((s) => s.initializeListeners);

  useEffect(() => {
    void loadLocales();
    initThemeFromConfig();
    initReadingFromConfig();
    initSidebarViewFromConfig();
    useSecretHealthStore.getState().initialize();
    void useFlowStore.getState().loadFlows();
    void settingsApi.getHotkey().then(setHotkey);
    void settingsApi.getRegionHotkey().then(useAppStore.getState().setRegionHotkey);
    void settingsApi.getShortcuts().then(useShortcutStore.getState().setOverrides);
    void settingsApi.getPromptPreferences().then((prefs) => setUserNickname(prefs.nickname ?? ''));
    void settingsApi.getAiUrl().then(hydrateAiUrl);
    void tempChatApi.getMode().then(setTempChatMode);
    initializeListeners();
    initChatDisplayFromConfig();
    initLinkRecognitionFromConfig();
    void byokApi.getSettings().then((snapshot) => {
      setByokGroupModels(makeByokGroupModels(snapshot.groups, snapshot.instances));
      setByokModels(snapshot.instances.map(makeByokModelOption));
    });
    void settingsApi.getHiddenSources().then(setHiddenSources);
    void accountApi.getStatuses().then(setAccountStatuses);
    // Hydrated here, not in the Settings hook: the composer derives a slash command per
    // connected server, so the list has to exist before Settings is ever opened.
    void mcpApi.list().then(useMcpStore.getState().setServers);
    // Same for the knowledge bases: the composer offers them next to the connectors.
    void loadKnowledgeBases();
    void geminiModelApi.get().then((state) => {
      setGeminiModels(state);
      if (state.catalog) return;
      // First run only (main refreshes aged lists); idle-deferred because it may drive the shared worker window.
      onIdle(() => {
        void geminiModelApi.refresh().then(setGeminiModels);
      });
    });
    void claudeModelApi.get().then((state) => {
      setClaudeModels(state);
      if (state.catalog) return;
      // Same first-run rule as Gemini; main skips it outright when Claude is hidden or signed out.
      onIdle(() => {
        void claudeModelApi.refresh().then(setClaudeModels);
      });
    });
    void perplexityModelApi.get().then((state) => {
      setPerplexityModels(state);
      if (state.catalog) return;
      // Same first-run rule; main reads nothing for a visitor or a hidden Perplexity.
      onIdle(() => {
        void perplexityModelApi.refresh().then(setPerplexityModels);
      });
    });
    void chatgptModelApi.get().then((state) => {
      setChatgptModels(state);
      if (state.catalog) return;
      // Same first-run rule again; main skips it when ChatGPT is hidden or signed out.
      onIdle(() => {
        void chatgptModelApi.refresh().then(setChatgptModels);
      });
    });
  }, [initializeListeners, loadLocales, setHotkey, setUserNickname, hydrateAiUrl, setByokModels, setByokGroupModels, setHiddenSources, setTempChatMode, setAccountStatuses, setGeminiModels, setClaudeModels, setChatgptModels, setPerplexityModels]);

  // The chat's model set from elsewhere (the Yobi connector, a bot) shows in the composer at once.
  useEffect(() => settingsApi.onAiUrlChanged((url) => useAppStore.getState().setAiUrl(url)), []);

  useEffect(() => {
    const unsubs = [
      ipcEvents.onLog(appendLog),
      ipcEvents.onStatus((s) => setStatus(s as 'idle' | 'processing')),
      ipcEvents.onQueueUpdate(setQueue),
      accountApi.onStatusChanged(setAccountStatus),
      ipcEvents.onNavigateSettings((category) => {
        if (category) useAppStore.getState().openSettingsCategory(category);
        else setView('settings');
      }),
      ipcEvents.onTempChatModeChanged((enabled) => {
        setTempChatMode(enabled);
        setView('chat');
      }),
      ipcEvents.onTempChatResult(({ content }) => setTempChatResult(content)),
      mcpApi.onServerStatus(useMcpStore.getState().setServers),
      knowledgeApi.onChanged(useKnowledgeStore.getState().setBases),
      knowledgeApi.onStatus(useKnowledgeStore.getState().applyStatus),
      geminiModelApi.onChanged(setGeminiModels),
      claudeModelApi.onChanged(setClaudeModels),
      chatgptModelApi.onChanged(setChatgptModels),
      perplexityModelApi.onChanged(setPerplexityModels),
      settingsApi.onLinkRecognitionChanged(useLinkRecognitionStore.getState().apply),
      settingsApi.onReadingZoomCommand(useAppStore.getState().applyReadingZoomCommand),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [appendLog, setStatus, setQueue, setAccountStatus, setView, setTempChatMode, setTempChatResult, setGeminiModels, setClaudeModels, setChatgptModels, setPerplexityModels]);

  useShortcutAction('nav.switchView', (_event, combo) => {
    const digit = Number(combo.slice(combo.lastIndexOf('+') + 1));
    const nextView = NAV_ORDER[digit - 1];
    if (nextView) setView(nextView);
  });
}
