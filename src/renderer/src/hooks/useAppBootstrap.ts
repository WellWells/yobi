import { useCallback, useEffect, useRef } from 'react';
import { NAV_ORDER, useAppStore } from '../store/appStore';
import { useAgentFlowStore } from '../store/useAgentFlowStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { initThemeFromConfig } from '../store/themeStore';
import type { LayoutMode } from '../store/appStore';
import { accountApi, byokApi, ipcEvents, settingsApi, tempChatApi } from '../api/electronApi';
import { isTypingTarget } from '../utils/domUtils';
import type { View } from '../store/appStore';
import { makeByokGroupModels, makeByokModelOption, makeDuckaiModelOption } from '../config/models';

const VIEW_BY_SHORTCUT: Record<string, View> = Object.fromEntries(NAV_ORDER.map((view, index) => [String(index + 1), view]));

export function useAppBootstrap() {
  // Store actions are stable references; selecting them individually avoids
  // re-rendering App on every unrelated store write (logs, queue, status).
  const appendLog = useAppStore((s) => s.appendLog);
  const setStatus = useAppStore((s) => s.setStatus);
  const setQueue = useAppStore((s) => s.setQueue);
  const setAccountStatuses = useAppStore((s) => s.setAccountStatuses);
  const setAccountStatus = useAppStore((s) => s.setAccountStatus);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const setView = useAppStore((s) => s.setView);
  const setAiUrl = useAppStore((s) => s.setAiUrl);
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
    void useAgentFlowStore.getState().loadFlows();
    void settingsApi.getHotkey().then(setHotkey);
    void settingsApi.getPromptPreferences().then((prefs) => setUserNickname(prefs.nickname ?? ''));
    void settingsApi.getAiUrl().then(setAiUrl);
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
    if (!duckaiModelsFetched.current) {
      duckaiModelsFetched.current = true;
      void settingsApi.fetchDuckaiModels().then((models) => {
        if (models && models.length > 0) {
          setDuckaiModels(models.map(makeDuckaiModelOption));
        }
      });
    }
    void byokApi.getSettings().then((snapshot) => {
      // Groups first so the "loaded" flag (flipped by setByokModels) never gates
      // ChatView's dangling-selection sweep on a half-populated picker.
      setByokGroupModels(makeByokGroupModels(snapshot.groups));
      setByokModels(snapshot.instances.map(makeByokModelOption));
    });
    void settingsApi.getHiddenSources().then(setHiddenSources);
    void accountApi.getStatuses().then(setAccountStatuses);
  }, [initializeListeners, loadLocales, setHotkey, setUserNickname, setAiUrl, setDuckaiModels, setByokModels, setByokGroupModels, setHiddenSources, setTempChatMode, setAccountStatuses]);

  useEffect(() => {
    const unsubs = [
      ipcEvents.onLog(appendLog),
      ipcEvents.onStatus((s) => setStatus(s as 'idle' | 'processing')),
      ipcEvents.onQueueUpdate(setQueue),
      accountApi.onStatusChanged(setAccountStatus),
      ipcEvents.onNavigateSettings(() => setView('settings')),
      // Toggling temporary chat (hotkey or button) always lands the user in the
      // chat view; ChatView then focuses the prompt input on the mode change.
      ipcEvents.onTempChatModeChanged((enabled) => {
        setTempChatMode(enabled);
        setView('chat');
      }),
      ipcEvents.onTempChatResult(({ content }) => setTempChatResult(content)),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [appendLog, setStatus, setQueue, setAccountStatus, setView, setTempChatMode, setTempChatResult]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.code.startsWith('Numpad')
      ? event.code.replace('Numpad', '')
      : event.key;
    const nextView = VIEW_BY_SHORTCUT[key];
    if (!nextView) return;
    event.preventDefault();
    setView(nextView);
  }, [setView]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
