// src/renderer/src/hooks/useAppBootstrap.ts
// Extracted from App.tsx so that App can focus purely on layout/view rendering.
import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
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
  const { appendLog, setStatus, setQueue, setHotkey, setView, setAiUrl, setDuckaiModels } = useAppStore();
  const { loadLocales } = useI18nStore();
  const { initializeListeners } = useUpdateStore();
  const duckaiModelsFetched = useRef(false);

  // One-time init: i18n, theme, and preference loading.
  useEffect(() => {
    void loadLocales();
    initThemeFromConfig();
    void settingsApi.getHotkey().then(setHotkey);
    // Preload aiUrl in parallel with loadLocales so ChatView has it on first render
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
    // Fetch duck.ai models once per app session; skip if already fetched.
    if (!duckaiModelsFetched.current) {
      duckaiModelsFetched.current = true;
      void settingsApi.fetchDuckaiModels().then((models) => {
        if (models && models.length > 0) {
          setDuckaiModels(models.map(makeDuckaiModelOption));
        }
      });
    }
  }, [initializeListeners, loadLocales, setHotkey, setAiUrl, setDuckaiModels]);

  // IPC event subscriptions.
  useEffect(() => {
    const unsubs = [
      ipcEvents.onLog(appendLog),
      ipcEvents.onStatus((s) => setStatus(s as 'idle' | 'processing')),
      ipcEvents.onQueueUpdate(setQueue),
      ipcEvents.onNavigateSettings(() => setView('settings')),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [appendLog, setStatus, setQueue, setView]);

  // Global Alt+[1-4] keyboard navigation.
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
