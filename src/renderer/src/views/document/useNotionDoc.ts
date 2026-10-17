import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotionDocStatus, NotionSyncError } from '../../../../shared/notion/notionSyncTypes';
import { notionApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useI18nStore } from '../../store/i18nStore';
import { useDocAssistantStore } from '../../store/docAssistantStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import { canPull, NOTION_FOCUS_PULL_GAP_MS, NOTION_PULL_INTERVAL_MS } from './documentSync';

export interface NotionDocSync {
  status: NotionDocStatus | null;
  busy: boolean;
  /** Someone else's changes were just merged in: how many places, until dismissed. */
  updated: number;
  dismissUpdated: () => void;
  pull: () => void;
  /** `title`: the H1 the preview showed, to send as the page title; null leaves it alone. */
  push: (ids: string[], title: string | null) => void;
  revert: (id: string) => void;
  resolve: (key: string, choice: 'mine' | 'theirs') => void;
}

function errorNotice(reason: NotionSyncError): void {
  const { t } = useI18nStore.getState();
  showAppNotice({ level: 'error', message: t(`notion.error.${reason}`) });
}

/**
 * One Notion document's sync as the document view sees it: the status main computes, reading the
 * page on open, on focus and every two minutes, and the user's own sends. Never sends by itself.
 * Mounted per document (the view is keyed by path), so nothing carries over from another one.
 */
export function useNotionDoc(path: string, content: string | null, editing: boolean): NotionDocSync {
  const [status, setStatus] = useState<NotionDocStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(0);
  const blockedRef = useRef({ editing, busy });
  blockedRef.current = { editing, busy };
  const lastPullRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await notionApi.status(path).catch(() => null));
  }, [path]);

  // The file changes under every sync and every save: the list of changes follows it.
  useEffect(() => {
    void refresh();
  }, [content, refresh]);

  const run = useCallback(async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    blockedRef.current = { ...blockedRef.current, busy: true };
    try {
      await task();
      await refresh();
    } finally {
      setBusy(false);
      blockedRef.current = { ...blockedRef.current, busy: false };
    }
  }, [refresh]);

  const pull = useCallback((quiet: boolean): void => {
    // A rewrite card for this document is matched against the text it was made from: a merge
    // under it would make "replace" fail.
    const rewriting = useWritingToolsStore.getState().job?.target.path === path;
    // The same for the assistant: its edits are placed in the text the request was sent with.
    const asking = Boolean(useDocAssistantStore.getState().threads[path]?.job);
    if (rewriting || asking || !canPull({ ...blockedRef.current, visible: document.visibilityState === 'visible' })) return;
    lastPullRef.current = Date.now();
    void run(async () => {
      const result = await notionApi.pull(path).catch(() => ({ ok: false as const, reason: 'failed' as const }));
      if (result.ok) {
        if (result.updated > 0) setUpdated((count) => count + result.updated);
      } else if (!quiet && result.reason !== 'notConnected') {
        errorNotice(result.reason);
      }
    });
  }, [path, run]);

  // On open, when the window comes back (not more than twice a minute), and every two minutes in front.
  useEffect(() => {
    pull(true);
    const onFocus = (): void => {
      if (Date.now() - lastPullRef.current >= NOTION_FOCUS_PULL_GAP_MS) pull(true);
    };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => pull(true), NOTION_PULL_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [pull]);

  const push = useCallback((ids: string[], title: string | null): void => {
    void run(async () => {
      const result = await notionApi.push(path, ids, title).catch(() => ({ ok: false as const, reason: 'failed' as const }));
      if (!result.ok) {
        errorNotice(result.reason);
        return;
      }
      if (result.refreshed) {
        const { t } = useI18nStore.getState();
        showAppNotice({ level: 'warning', message: t('notion.notice.refreshed') });
      }
      if (result.failed) errorNotice(result.failed);
      if (result.updated > 0) setUpdated((count) => count + result.updated);
    });
  }, [path, run]);

  const revert = useCallback((id: string): void => {
    void run(async () => {
      if (!await notionApi.revert(path, id).catch(() => false)) errorNotice('failed');
    });
  }, [path, run]);

  const resolve = useCallback((key: string, choice: 'mine' | 'theirs'): void => {
    void run(async () => {
      if (!await notionApi.resolve(path, key, choice).catch(() => false)) errorNotice('failed');
    });
  }, [path, run]);

  return {
    status,
    busy,
    updated,
    dismissUpdated: useCallback(() => setUpdated(0), []),
    pull: useCallback(() => pull(false), [pull]),
    push,
    revert,
    resolve,
  };
}
