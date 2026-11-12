import { startTransition, useCallback, useEffect, useRef } from 'react';
import type { ChatTurnEvent, ShellOutputEvent, ShellRunReply } from '../../../shared/types';
import { attachmentMetaNames } from '../../../shared/conversationDoc';
import { fileApi, promptApi, ipcEvents, shellApi } from '../api/electronApi';
import { NEW_CONVERSATION_KEY, useAppStore } from '../store/appStore';
import { remapPathValues, useConversationMoves } from '../store/conversationMoves';
import { resolveSendTarget } from './sendTarget';
import { pendingPromptOf } from './useCommandTurn';
import { consumeSendStopped, giveBackStoppedPrompt } from '../utils/stoppedSends';

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
  // A conversation moved into a folder while its answer was coming is still where the answer goes.
  useConversationMoves((moves) => remapPathValues(originBySendId.current, moves));

  const sendTurn = useCallback(({ prompt, targetUrl, attachments }: SendTurnRequest): void => {
    void (async () => {
      const conversationPath = await conversationForSend(prompt);
      const sendId = nextSendId();
      const attached = attachmentMetaNames(attachments ?? []);
      originBySendId.current.set(sendId, conversationPath);
      useAppStore.getState().addPendingTurn(
        conversationPath || NEW_CONVERSATION_KEY,
        { sendId, prompt, ...(attached.length > 0 ? { attachments: attached, attachmentFiles: attachments } : {}) },
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

  /** A `!` line: run on this computer, its output shown as it comes, then read by the model. */
  const runShell = useCallback(({ command, targetUrl }: { command: string; targetUrl: string }): void => {
    void (async () => {
      const record = `! ${command}`;
      const conversationPath = await conversationForSend(record);
      const sendId = nextSendId();
      originBySendId.current.set(sendId, conversationPath);
      useAppStore.getState().addPendingTurn(
        conversationPath || NEW_CONVERSATION_KEY,
        { sendId, prompt: record, shell: { command, output: '', running: true } },
      );
      const reply = await shellApi.run({
        command,
        targetUrl,
        sendId,
        ...(conversationPath ? { conversationPath } : {}),
      }).catch((): ShellRunReply => ({ ok: false, error: '' }));
      if (reply.ok) return;
      originBySendId.current.delete(sendId);
      useAppStore.getState().clearPendingTurn(sendId);
      if (reply.error) onError(reply.error);
    })();
  }, [onError]);

  useEffect(() => {
    const unsubscribe = ipcEvents.onChatTurn((event: ChatTurnEvent) => {
      void handleChatTurn(event, originBySendId.current, onError);
    });
    return unsubscribe;
  }, [onError]);

  useEffect(() => shellApi.onOutput((event: ShellOutputEvent) => {
    useAppStore.getState().updatePendingShell(event.sendId, {
      shellLabel: event.shell,
      folder: event.folder,
      running: !event.done,
      output: event.text,
      ...(event.done ? { exitCode: event.exitCode, stopped: event.stopped } : {}),
    });
  }), []);

  return { sendTurn, runShell };
}

/** The open conversation, or a new file for the first message (none in a temporary chat). */
async function conversationForSend(prompt: string): Promise<string> {
  const state = useAppStore.getState();
  const target = resolveSendTarget({
    selectedFilePath: state.selectedFile?.path ?? '',
    tempChatMode: state.tempChatMode,
  });
  if (target.releaseSelectedFile) state.selectFile(null);
  if (target.conversationPath || state.tempChatMode) return target.conversationPath;
  const started = await fileApi.startConversation(prompt);
  if (!started) return '';
  const store = useAppStore.getState();
  store.setFiles(started.files);
  if (!store.selectedFile) {
    store.selectFile(started.file);
    store.setFileContent(started.content);
  }
  return started.path;
}

async function handleChatTurn(
  event: ChatTurnEvent,
  origins: Map<string, string>,
  onError: (message: string) => void,
): Promise<void> {
  const store = useAppStore.getState();
  const origin = origins.get(event.sendId);
  origins.delete(event.sendId);

  if (event.stopped) {
    // Stop pressed: no error to show, and the question goes back into the composer (a `!`
    // command's turn was kept with its output, so there is nothing to give back).
    consumeSendStopped(event.sendId);
    if (!event.kept) giveBackStoppedPrompt(pendingPromptOf(event.sendId));
  } else if (event.phase === 'error') {
    onError(event.error ?? '');
  }
  if (event.phase === 'error') {
    // A `!` command's turn was written without an answer: reloaded like an answered one.
    if (!event.kept) {
      store.clearPendingTurn(event.sendId);
      return;
    }
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
