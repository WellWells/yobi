import { fileApi } from '../api/electronApi';
import { showAppNotice } from '../hooks/useUiNotifications';
import type { MarkdownExportResult } from '../../../shared/types';

/**
 * Saves one conversation as plain Markdown (no hidden markers) where the user picks, then says
 * how it went: the saved file on success, nothing when the save dialog was canceled, an error
 * otherwise. The header's ⋮ and the sidebar's right-click menu both come through here, so the
 * two never word it differently.
 */
export async function exportConversationMarkdown(filePath: string, t: (key: string) => string): Promise<void> {
  const result: MarkdownExportResult = await fileApi.exportMarkdown(filePath).catch(() => ({ ok: false }));
  if (result.ok) {
    showAppNotice({ message: t('header.menu.export.markdownSaved'), level: 'success', filePath: result.filePath });
    return;
  }
  if (result.canceled) return;
  showAppNotice({ message: t('header.menu.export.markdownFailed'), level: 'error' });
}
