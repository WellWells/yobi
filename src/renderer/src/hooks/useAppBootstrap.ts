import { useEffect, useRef } from 'react';
import { NAV_ORDER, useAppStore } from '../store/appStore';
import { useFlowStore } from '../store/useFlowStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { initThemeFromConfig } from '../store/themeStore';
import type { LayoutMode } from '../store/appStore';
import { accountApi, byokApi, ipcEvents, settingsApi, tempChatApi } from '../api/electronApi';
import { makeByokGroupModels, makeByokModelOption, makeDuckaiModelOption } from '../config/models';
import { useShortcutAction } from '../shortcuts/useShortcutAction';
import { useShortcutStore } from '../store/shortcutStore';
import { onIdle } from '../utils/idle';

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
  const setDuckaiModels = useAppStore((s) => s.setDuckaiModels);
  const setByokModels = useAppStore((s) => s.setByokModels);
  const setByokGroupModels = useAppStore((s) => s.setByokGroupModels);
  const setHiddenSources = useAppStore((s) => s.setHiddenSources);
  const setTempChatMode = useAppStore((s) => s.setTempChatMode);
  const setTempChatResult = useAppStore((s) => s.setTempChatResult);
  const loadLocales = useI18nStore((s) => s.loadLocales);
  const initializeListeners = useUpdateStore((s) => s.initializeListeners);
  const duckaiModelsFetched = useRef(false);

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
    if (!duckaiModelsFetched.current) {
      duckaiModelsFetched.current = true;
      // Unlike its neighbours this is not a config read: it drives the shared worker
      // window through a real Duck.ai page load and clicks the model picker open,
      // measured at ~1.8 s of main-process work. Off the boot window it goes, so it
      // stops racing the provider warm-up for the very same worker window.
      onIdle(() => {
        void settingsApi.fetchDuckaiModels().then((models) => {
          if (models && models.length > 0) {
            setDuckaiModels(models.map(makeDuckaiModelOption));
          }
        });
      });
    }
    void byokApi.getSettings().then((snapshot) => {
      setByokGroupModels(makeByokGroupModels(snapshot.groups));
      setByokModels(snapshot.instances.map(makeByokModelOption));
    });
    void settingsApi.getHiddenSources().then(setHiddenSources);
    void accountApi.getStatuses().then(setAccountStatuses);
  }, [initializeListeners, loadLocales, setHotkey, setHotkeyEnabled, setUserNickname, hydrateAiUrl, setDuckaiModels, setByokModels, setByokGroupModels, setHiddenSources, setTempChatMode, setAccountStatuses]);

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
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [appendLog, setStatus, setQueue, setAccountStatus, setView, setTempChatMode, setTempChatResult]);

  useShortcutAction('nav.switchView', (_event, combo) => {
    const digit = Number(combo.slice(combo.lastIndexOf('+') + 1));
    const nextView = NAV_ORDER[digit - 1];
    if (nextView) setView(nextView);
  });
}
