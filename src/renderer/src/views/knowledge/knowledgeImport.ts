import { knowledgeApi, systemApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useKnowledgeStore } from '../../store/useKnowledgeStore';
import { fillTemplate } from '../../../../shared/fillTemplate';

/**
 * Adds files to a base — dropped on its page or its sidebar row, or picked — by copying them into
 * its folder (main skips folders and types a base does not read); the folder watcher reads them.
 * Says how many went in and how many did not.
 */
export async function importPathsIntoKnowledgeBase(kbId: string, paths: string[], t: (key: string) => string): Promise<boolean> {
  if (paths.length === 0) return false;
  const result = await knowledgeApi.importFiles(kbId, paths).catch(() => null);
  if (!result) return false;
  const name = useKnowledgeStore.getState().bases.find((kb) => kb.id === kbId)?.name ?? '';
  if (result.added > 0) {
    showAppNotice({ level: 'success', message: fillTemplate(t('kb.page.imported'), { count: String(result.added), name }) });
  }
  if (result.skipped + result.failed > 0) {
    showAppNotice({ level: 'warning', message: fillTemplate(t('kb.page.importSkipped'), { count: String(result.skipped + result.failed) }) });
  }
  return result.added > 0;
}

export function importIntoKnowledgeBase(kbId: string, files: File[], t: (key: string) => string): void {
  void importPathsIntoKnowledgeBase(kbId, files.map((file) => systemApi.getPathForFile(file)).filter(Boolean), t);
}
