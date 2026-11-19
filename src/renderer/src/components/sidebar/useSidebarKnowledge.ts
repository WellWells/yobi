import { useCallback, useMemo, useState } from 'react';
import { knowledgeApi } from '../../api/electronApi';
import { importIntoKnowledgeBase } from '../../views/knowledge/knowledgeImport';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useAppStore } from '../../store/appStore';
import { useKnowledgeStore } from '../../store/useKnowledgeStore';
import type { KnowledgeSaveError, KnowledgeStatus } from '../../../../shared/knowledgeStatus';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { SidebarKnowledgeBase } from '../../utils/timeGroups';
import type { MenuAnchor } from '../RowMoreButton';
import { addKnowledgeFromFolder } from './knowledgeActions';

type Translate = (key: string) => string;

export interface KnowledgeMenuState {
  x: number;
  y: number;
  base: SidebarKnowledgeBase;
}

function saveErrorNotice(error: KnowledgeSaveError, t: Translate): void {
  showAppNotice({ level: 'error', message: t(`settings.knowledge.error.${error}`) });
}

/**
 * The sidebar's knowledge bases: the rows, the heading's 「＋」 (pick a folder → a base named after
 * it → its page), a click on a row (its page: files, analysis, a box to ask it), files dropped on
 * a row (added to it), and the row menu — rename in place, refresh, show the folder, remove (the
 * files stay; removing only drops the index).
 */
export function useSidebarKnowledge(t: Translate) {
  // Not the statuses: they change after every file indexed; each row reads its own.
  const bases = useKnowledgeStore((s) => s.bases);
  const openKnowledge = useAppStore((s) => s.openKnowledge);
  const openId = useAppStore((s) => s.openKnowledgeId);
  const [menu, setMenu] = useState<KnowledgeMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const rows = useMemo<SidebarKnowledgeBase[]>(() => bases.map(({ id, name }) => ({ id, name })), [bases]);

  const add = useCallback(async (): Promise<void> => {
    const result = await addKnowledgeFromFolder({
      bases: useKnowledgeStore.getState().bases,
      pickFolder: knowledgeApi.pickFolder,
      save: async (request) => {
        const saved = await knowledgeApi.save(request);
        if ('bases' in saved) useKnowledgeStore.getState().setBases(saved.bases);
        return saved;
      },
    }).catch((): null => null);
    if (!result) {
      saveErrorNotice('folder', t);
      return;
    }
    if (result.kind === 'cancelled') return;
    if (result.kind === 'error') {
      saveErrorNotice(result.error, t);
      return;
    }
    // Its page: the files it found are what the user wants to see first, over the composer to ask it.
    openKnowledge(result.id);
  }, [openKnowledge, t]);

  const open = useCallback((base: SidebarKnowledgeBase) => openKnowledge(base.id), [openKnowledge]);

  // Files dropped on a row: copied into its folder (the watcher reads them, OCR for scans).
  const importFiles = useCallback((base: SidebarKnowledgeBase, dropped: File[]) => {
    importIntoKnowledgeBase(base.id, dropped, t);
  }, [t]);

  const openMenu = useCallback((e: React.MouseEvent<HTMLElement>, base: SidebarKnowledgeBase) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, base });
  }, []);
  // The "⋯" opens the same menu under the button; again closes it.
  const openMenuAt = useCallback((base: SidebarKnowledgeBase, at: MenuAnchor) => {
    setMenu((current) => (current?.base.id === base.id ? null : { ...at, base }));
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const startRename = useCallback((base: SidebarKnowledgeBase) => {
    setMenu(null);
    setRenameText(base.name);
    setRenaming(base.id);
  }, []);
  const cancelRename = useCallback(() => setRenaming(null), []);
  const commitRename = useCallback(() => {
    const id = renaming;
    setRenaming(null);
    const kb = useKnowledgeStore.getState().bases.find((entry) => entry.id === id);
    const name = renameText.trim();
    if (!kb || !name || name === kb.name) return;
    void knowledgeApi.save({ id: kb.id, name, folder: kb.folder, aliases: kb.aliases }).then((saved) => {
      if ('bases' in saved) useKnowledgeStore.getState().setBases(saved.bases);
      else saveErrorNotice(saved.error, t);
    });
  }, [renaming, renameText, t]);

  const sync = useCallback((base: SidebarKnowledgeBase) => { void knowledgeApi.sync(base.id); }, []);
  const openFolder = useCallback((base: SidebarKnowledgeBase) => {
    void knowledgeApi.openFolder(base.id).then((opened) => {
      if (!opened) showAppNotice({ level: 'error', message: t('settings.knowledge.status.folderMissing') });
    });
  }, [t]);
  const remove = useCallback((base: SidebarKnowledgeBase) => {
    void knowledgeApi.remove(base.id).then((left) => useKnowledgeStore.getState().setBases(left));
  }, []);

  /**
   * What a row's warning mark says: the folder is gone, or files in it had no text to search — a
   * file that went in but cannot be found by a search must not pass in silence.
   */
  const warningFor = useCallback((status: KnowledgeStatus | undefined): string | null => {
    if (!status) return null;
    if (status.folderMissing) return t('settings.knowledge.status.folderMissing');
    if (status.failed > 0) return fillTemplate(t('settings.knowledge.status.unreadable'), { count: status.failed });
    return null;
  }, [t]);

  return {
    rows, openId, add, open, importFiles, menu, openMenu, openMenuAt, closeMenu,
    renaming, renameText, setRenameText, startRename, cancelRename, commitRename,
    sync, openFolder, remove, warningFor,
  };
}
