import { startTransition, useCallback, useRef } from 'react';
import { attachmentMetaNames } from '../../../shared/conversationDoc';
import { fileApi } from '../api/electronApi';
import { NEW_CONVERSATION_KEY, useAppStore } from '../store/appStore';
import { remapPathValues, useConversationMoves } from '../store/conversationMoves';
import { consumeSendStopped, giveBackStoppedPrompt } from '../utils/stoppedSends';

/** The question a pending send shows, wherever its conversation is. */
export function pendingPromptOf(sendId: string): string {
  for (const turns of Object.values(useAppStore.getState().pendingTurns)) {
    const turn = turns.find((candidate) => candidate.sendId === sendId);
    if (turn) return turn.prompt;
  }
  return '';
}

let commandSendCounter = 0;
function nextCommandSendId(): string {
  commandSendCounter += 1;
  return `cmd-${Date.now()}-${commandSendCounter}`;
}

export function useCommandTurn() {
  const originBySendId = useRef(new Map<string, string>());
  // A conversation moved into a folder while its command ran is still where the answer goes.
  useConversationMoves((moves) => remapPathValues(originBySendId.current, moves));

  const begin = useCallback((prompt: string, runId?: string, attachments?: string[], command?: boolean): string => {
    const conversationPath = useAppStore.getState().selectedFile?.path ?? '';
    const sendId = nextCommandSendId();
    const attached = attachmentMetaNames(attachments ?? []);
    originBySendId.current.set(sendId, conversationPath);
    useAppStore.getState().addPendingTurn(
      conversationPath || NEW_CONVERSATION_KEY,
      {
        sendId,
        prompt,
        beganAt: Date.now(),
        ...(runId ? { runId } : {}),
        ...(attached.length > 0 ? { attachments: attached, attachmentFiles: attachments } : {}),
        ...(command ? { command } : {}),
      },
    );
    return sendId;
  }, []);

  /** True when the user stopped it: nothing went wrong, so the caller shows no error. */
  const fail = useCallback((sendId: string): boolean => {
    originBySendId.current.delete(sendId);
    const stoppedByUser = consumeSendStopped(sendId);
    if (stoppedByUser) giveBackStoppedPrompt(pendingPromptOf(sendId));
    useAppStore.getState().clearPendingTurn(sendId);
    return stoppedByUser;
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
