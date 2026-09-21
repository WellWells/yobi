import { startTransition, useCallback, useEffect, useRef } from 'react';
import type { ChatTurnEvent } from '../../../shared/types';
import { attachmentMetaNames } from '../../../shared/conversationDoc';
import { fileApi, promptApi, ipcEvents } from '../api/electronApi';
import { NEW_CONVERSATION_KEY, useAppStore } from '../store/appStore';
import { resolveSendTarget } from './sendTarget';

export interface SendTurnRequest {
  prompt: string;
  targetUrl: string;
  attachments?: string[];
}

let sendCounter = 0;
function nextSendId(): string {
  sendCounter += 1;
  return `send-${Date.now()}-${sendCounter}`;
}

export function useConversationTurns(onError: (message: string) => void) {
  const originBySendId = useRef(new Map<string, string>());

  const sendTurn = useCallback(({ prompt, targetUrl, attachments }: SendTurnRequest): void => {
    void (async () => {
      const state = useAppStore.getState();
      const target = resolveSendTarget({
        selectedFilePath: state.selectedFile?.path ?? '',
        tempChatMode: state.tempChatMode,
      });
      let conversationPath = target.conversationPath;
      if (target.releaseSelectedFile) state.selectFile(null);

      if (!conversationPath && !state.tempChatMode) {
        const started = await fileApi.startConversation(prompt);
        if (started) {
          conversationPath = started.path;
          const store = useAppStore.getState();
          store.setFiles(started.files);
          if (!store.selectedFile) {
            store.selectFile(started.file);
            store.setFileContent(started.content);
          }
        }
      }

      const sendId = nextSendId();
      const attached = attachmentMetaNames(attachments ?? []);
      originBySendId.current.set(sendId, conversationPath);
      useAppStore.getState().addPendingTurn(
        conversationPath || NEW_CONVERSATION_KEY,
        { sendId, prompt, ...(attached.length > 0 ? { attachments: attached } : {}) },
      );

      promptApi.triggerWithOptions({
        prompt,
        targetUrl,
        sendId,
        ...(conversationPath ? { conversationPath } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      });
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = ipcEvents.onChatTurn((event: ChatTurnEvent) => {
      void handleChatTurn(event, originBySendId.current, onError);
    });
    return unsubscribe;
  }, [onError]);

  return { sendTurn };
}

async function handleChatTurn(
  event: ChatTurnEvent,
  origins: Map<string, string>,
  onError: (message: string) => void,
): Promise<void> {
  const store = useAppStore.getState();
  const origin = origins.get(event.sendId);
  origins.delete(event.sendId);

  if (event.phase === 'error') {
    store.clearPendingTurn(event.sendId);
    onError(event.error ?? '');
    return;
  }
  if (!event.conversationPath) {
    store.clearPendingTurn(event.sendId);
    return;
  }

  const latest = await fileApi.getList();
  // Read BEFORE the list is applied: setFiles releases a selection that is no longer listed,
  // and this question is about whether the user has navigated away, not about that.
  const stillHere = (useAppStore.getState().selectedFile?.path ?? '') === (origin ?? '');
  store.setFiles(latest);

  const file = latest.find((candidate) => candidate.path === event.conversationPath);
  if (!stillHere || !file) {
    store.clearPendingTurn(event.sendId);
    return;
  }

  useAppStore.getState().selectFile(file);
  const content = await fileApi.getContent(file.path);
  startTransition(() => {
    useAppStore.getState().setFileContent(content);
    useAppStore.getState().clearPendingTurn(event.sendId);
  });
}
