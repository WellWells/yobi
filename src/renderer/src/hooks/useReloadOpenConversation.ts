import { startTransition, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { fileApi, ipcEvents } from '../api/electronApi';

/**
 * Re-reads the open conversation when its .md on disk no longer matches the screen. Skipped
 * while a send into it is in flight: its `CHAT_TURN` re-reads the file once the answer lands,
 * and reading earlier would show the half-written file.
 */
export async function reloadOpenConversation(): Promise<void> {
  const path = useAppStore.getState().selectedFile?.path;
  if (!path || useAppStore.getState().pendingTurns[path]?.length) return;
  const latest = await fileApi.getContent(path);
  const store = useAppStore.getState();
  if (latest === null || store.selectedFile?.path !== path || latest === store.fileContent) return;
  if (store.pendingTurns[path]?.length) return;
  const files = await fileApi.getList();
  const current = useAppStore.getState();
  current.setFiles(files);
  const file = files.find((candidate) => candidate.path === path);
  if (!file || current.selectedFile?.path !== path) return;
  current.selectFile(file);
  startTransition(() => useAppStore.getState().setFileContent(latest));
}

/** A .md in the outputs folder changed: the sidebar may have gained, lost or retitled a file. */
export async function refreshAfterOutputChange(): Promise<void> {
  const files = await fileApi.getList();
  useAppStore.getState().setFiles(files, { markUnread: true });
  await reloadOpenConversation();
}

/**
 * The open conversation is a plain .md the user can edit in another app (VS Code, the
 * sidebar's "Open with"). The main process watches the outputs folder and says when a .md
 * there changed; coming back to Yobi re-reads as well, for anything the watcher cannot see
 * (a network drive). Otherwise the screen keeps the old text while the next turn is appended
 * to the edited file.
 */
export function useReloadOpenConversation(): void {
  useEffect(() => {
    const onFocus = () => { void reloadOpenConversation(); };
    window.addEventListener('focus', onFocus);
    const unsubscribe = ipcEvents.onOutputFilesChanged(() => { void refreshAfterOutputChange(); });
    return () => {
      window.removeEventListener('focus', onFocus);
      unsubscribe();
    };
  }, []);
}
