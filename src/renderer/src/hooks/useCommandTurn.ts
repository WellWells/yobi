import { startTransition, useCallback, useRef } from 'react';
import { fileApi } from '../api/electronApi';
import { NEW_CONVERSATION_KEY, useAppStore } from '../store/appStore';

let commandSendCounter = 0;
function nextCommandSendId(): string {
  commandSendCounter += 1;
  return `cmd-${Date.now()}-${commandSendCounter}`;
}

export function useCommandTurn() {
  const originBySendId = useRef(new Map<string, string>());

  const begin = useCallback((prompt: string, runId?: string, attachments?: string[]): string => {
    const conversationPath = useAppStore.getState().selectedFile?.path ?? '';
    const sendId = nextCommandSendId();
    originBySendId.current.set(sendId, conversationPath);
    useAppStore.getState().addPendingTurn(
      conversationPath || NEW_CONVERSATION_KEY,
      {
        sendId,
        prompt,
        ...(runId ? { runId } : {}),
        ...(attachments?.length ? { attachments } : {}),
      },
    );
    return sendId;
  }, []);

  const fail = useCallback((sendId: string): void => {
    originBySendId.current.delete(sendId);
    useAppStore.getState().clearPendingTurn(sendId);
  }, []);

  const finish = useCallback(async (sendId: string, filePath?: string): Promise<void> => {
    const origin = originBySendId.current.get(sendId);
    originBySendId.current.delete(sendId);

    if (!filePath) {
      useAppStore.getState().clearPendingTurn(sendId);
      return;
    }

    const latest = await fileApi.getList();
    // Read BEFORE the list is applied: setFiles releases a selection that is no longer listed,
    // and this question is about whether the user has navigated away, not about that.
    const stillHere = (useAppStore.getState().selectedFile?.path ?? '') === (origin ?? '');
    useAppStore.getState().setFiles(latest);

    const file = latest.find((candidate) => candidate.path === filePath);
    if (!stillHere || !file) {
      useAppStore.getState().clearPendingTurn(sendId);
      return;
    }

    useAppStore.getState().selectFile(file);
    const content = await fileApi.getContent(file.path);
    startTransition(() => {
      useAppStore.getState().setFileContent(content);
      useAppStore.getState().clearPendingTurn(sendId);
    });
  }, []);

  return { begin, finish, fail };
}
