import { useCallback } from 'react';
import { fileApi, systemApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useI18nStore } from '../../store/i18nStore';
import type { ConversationImportResult, OutputFile } from '../../../../shared/types';
import { fillTemplate } from '../../../../shared/fillTemplate';

/** What the "Import conversations…" file picker offers: the extensions main's import accepts. */
export const IMPORT_ACCEPT = '.md,.markdown';

/**
 * A row dragged out of the list carries itself — or, when it is one of the ticked rows in
 * select mode, every ticked row, in list order.
 */
export function pathsToDrag(
  path: string,
  selectMode: boolean,
  selected: ReadonlySet<string>,
  orderedPaths: readonly string[],
): string[] {
  if (!selectMode || !selected.has(path)) return [path];
  return orderedPaths.filter((candidate) => selected.has(candidate));
}

/** The notices one drop earns, worst news last so it is the one left reading. */
export function importNotices(
  result: Pick<ConversationImportResult, 'imported' | 'skipped' | 'failed'>,
  t: (key: string) => string,
): Array<{ title: string; level: 'success' | 'warning' | 'error' }> {
  const notices: Array<{ title: string; level: 'success' | 'warning' | 'error' }> = [];
  if (result.imported.length > 0) {
    notices.push({ title: fillTemplate(t('sidebar.import.done'), { count: String(result.imported.length) }), level: 'success' });
  }
  if (result.skipped > 0) notices.push({ title: t('sidebar.import.notMarkdown'), level: 'warning' });
  if (result.failed > 0) {
    notices.push({ title: fillTemplate(t('sidebar.import.failed'), { count: String(result.failed) }), level: 'error' });
  }
  return notices;
}

/**
 * Files dropped on the conversation list, or picked with its import button: Markdown is copied in as a conversation and the
 * first one opens. A file that is already in the list (a row dragged out and straight back)
 * just opens.
 */
export function useConversationImport(onOpen: (file: OutputFile) => Promise<void>): (files: File[]) => void {
  const t = useI18nStore((s) => s.t);

  return useCallback((files: File[]) => {
    const paths = files.map((file) => systemApi.getPathForFile(file)).filter(Boolean);
    const unreadable = files.length - paths.length;
    void (async () => {
      let result: ConversationImportResult;
      try {
        result = paths.length > 0
          ? await fileApi.importConversations(paths)
          : { imported: [], existing: [], skipped: 0, failed: 0, files: [] };
      } catch {
        result = { imported: [], existing: [], skipped: 0, failed: paths.length, files: [] };
      }
      const target = result.imported[0] ?? result.existing[0];
      const file = target ? result.files.find((entry) => entry.path === target) : undefined;
      if (file) await onOpen(file);
      for (const notice of importNotices({ ...result, failed: result.failed + unreadable }, t)) {
        showAppNotice(notice);
      }
    })();
  }, [onOpen, t]);
}
