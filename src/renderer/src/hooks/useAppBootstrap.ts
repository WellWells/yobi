import { useEffect } from 'react';
import { NAV_ORDER, useAppStore } from '../store/appStore';
import { useFlowStore } from '../store/useFlowStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { useMcpStore } from '../store/useMcpStore';
import { initThemeFromConfig } from '../store/themeStore';
import type { LayoutMode } from '../store/appStore';
import { accountApi, byokApi, chatgptModelApi, claudeModelApi, geminiModelApi, ipcEvents, mcpApi, settingsApi, tempChatApi } from '../api/electronApi';
import { onIdle } from '../utils/idle';
import { makeByokGroupModels, makeByokModelOption } from '../config/models';
import { useShortcutAction } from '../shortcuts/useShortcutAction';
import { useShortcutStore } from '../store/shortcutStore';

export function useAppBootstrap() {
  const appendLog = useAppStore((s) => s.appendLog);
  const setStatus = useAppStore((s) => s.setStatus);
  const setQueue = useAppStore((s) => s.setQueue);
  const setAccountStatuses = useAppStore((s) => s.setAccountStatuses);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const setHotkeyEnabled = useAppStore((s) => s.setHotkeyEnabled);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const setView = useAppStore((s) => s.setView);
  const hydrateAiUrl = useAppStore((s) => s.hydrateAiUrl);
  const setByokModels = useAppStore((s) => s.setByokModels);
  const setByokGroupModels = useAppStore((s) => s.setByokGroupModels);
  const setHiddenSources = useAppStore((s) => s.setHiddenSources);
  const setGeminiModels = useAppStore((s) => s.setGeminiModels);
  const setClaudeModels = useAppStore((s) => s.setClaudeModels);
  const setChatgptModels = useAppStore((s) => s.setChatgptModels);
  const setTempChatMode = useAppStore((s) => s.setTempChatMode);
  const setTempChatResult = useAppStore((s) => s.setTempChatResult);
  const loadLocales = useI18nStore((s) => s.loadLocales);
  const initializeListeners = useUpdateStore((s) => s.initializeListeners);

  useEffect(() => {
    void loadLocales();
    initThemeFromConfig();
    useSecretHealthStore.getState().initialize();
    void useFlowStore.getState().loadFlows();
    void settingsApi.getHotkey().then(setHotkey);
    void settingsApi.getHotkeyEnabled().then(setHotkeyEnabled);
    void settingsApi.getShortcuts().then(useShortcutStore.getState().setOverrides);
    void settingsApi.getPromptPreferences().then((prefs) => setUserNickname(prefs.nickname ?? ''));
    void settingsApi.getAiUrl().then(hydrateAiUrl);
    void tempChatApi.getMode().then(setTempChatMode);
    initializeListeners();
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
    void byokApi.getSettings().then((snapshot) => {
      setByokGroupModels(makeByokGroupModels(snapshot.groups));
      setByokModels(snapshot.instances.map(makeByokModelOption));
    });
    void settingsApi.getHiddenSources().then(setHiddenSources);
    void accountApi.getStatuses().then(setAccountStatuses);
    // Hydrated here, not in the Settings hook: the composer derives a slash command per
    // connected server, so the list has to exist before Settings is ever opened.
    void mcpApi.list().then(useMcpStore.getState().setServers);
    void geminiModelApi.get().then((state) => {
      setGeminiModels(state);
      if (state.catalog) return;
      // Only with nothing cached yet (a first run). Unlike its neighbours this is not a config
      // read: it may load Gemini in the shared worker window and open its model picker, so it
      // stays off the boot window instead of racing the worker warm-up.
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
    void chatgptModelApi.get().then((state) => {
      setChatgptModels(state);
      if (state.catalog) return;
      // Same first-run rule again; main skips it when ChatGPT is hidden or signed out.
      onIdle(() => {
        void chatgptModelApi.refresh().then(setChatgptModels);
      });
    });
  }, [initializeListeners, loadLocales, setHotkey, setHotkeyEnabled, setUserNickname, hydrateAiUrl, setByokModels, setByokGroupModels, setHiddenSources, setTempChatMode, setAccountStatuses, setGeminiModels, setClaudeModels, setChatgptModels]);

  useEffect(() => {
    const unsubs = [
      ipcEvents.onLog(appendLog),
      ipcEvents.onStatus((s) => setStatus(s as 'idle' | 'processing')),
      ipcEvents.onQueueUpdate(setQueue),
      accountApi.onStatusChanged(setAccountStatus),
      ipcEvents.onNavigateSettings(() => setView('settings')),
      ipcEvents.onTempChatModeChanged((enabled) => {
        setTempChatMode(enabled);
        setView('chat');
      }),
      ipcEvents.onTempChatResult(({ content }) => setTempChatResult(content)),
      mcpApi.onServerStatus(useMcpStore.getState().setServers),
      geminiModelApi.onChanged(setGeminiModels),
      claudeModelApi.onChanged(setClaudeModels),
      chatgptModelApi.onChanged(setChatgptModels),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [appendLog, setStatus, setQueue, setAccountStatus, setView, setTempChatMode, setTempChatResult, setGeminiModels, setClaudeModels, setChatgptModels]);

  useShortcutAction('nav.switchView', (_event, combo) => {
    const digit = Number(combo.slice(combo.lastIndexOf('+') + 1));
    const nextView = NAV_ORDER[digit - 1];
    if (nextView) setView(nextView);
  });
}
