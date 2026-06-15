import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { useAgentFlowStore } from '../store/useAgentFlowStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { initThemeFromConfig } from '../store/themeStore';
import type { LayoutMode } from '../store/appStore';
import { ipcEvents, settingsApi } from '../api/electronApi';
import { isTypingTarget } from '../utils/domUtils';
import type { View } from '../store/appStore';
import { makeDuckaiModelOption } from '../config/models';

const VIEW_BY_SHORTCUT: Record<string, View> = {
  '1': 'chat',
  '2': 'settings',
  '3': 'logs',
  '4': 'about',
};

export function useAppBootstrap() {
  // Store actions are stable references; selecting them individually avoids
  // re-rendering App on every unrelated store write (logs, queue, status).
  const appendLog = useAppStore((s) => s.appendLog);
  const setStatus = useAppStore((s) => s.setStatus);
  const setQueue = useAppStore((s) => s.setQueue);
  const setWorkerAttention = useAppStore((s) => s.setWorkerAttention);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const setView = useAppStore((s) => s.setView);
  const setAiUrl = useAppStore((s) => s.setAiUrl);
  const setDuckaiModels = useAppStore((s) => s.setDuckaiModels);
  const loadLocales = useI18nStore((s) => s.loadLocales);
  const initializeListeners = useUpdateStore((s) => s.initializeListeners);
  const duckaiModelsFetched = useRef(false);

  useEffect(() => {
    void loadLocales();
    initThemeFromConfig();
    void useAgentFlowStore.getState().loadFlows();
    void settingsApi.getHotkey().then(setHotkey);
    void settingsApi.getAiUrl().then(setAiUrl);
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
  }, [initializeListeners, loadLocales, setHotkey, setAiUrl, setDuckaiModels]);

  useEffect(() => {
    const unsubs = [
      ipcEvents.onLog(appendLog),
      ipcEvents.onStatus((s) => setStatus(s as 'idle' | 'processing')),
      ipcEvents.onQueueUpdate(setQueue),
      ipcEvents.onWorkerStatus(setWorkerAttention),
      ipcEvents.onNavigateSettings(() => setView('settings')),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [appendLog, setStatus, setQueue, setWorkerAttention, setView]);

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
