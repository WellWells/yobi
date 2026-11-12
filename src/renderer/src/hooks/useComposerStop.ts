import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { NEW_CONVERSATION_KEY, useAppStore } from '../store/appStore';
import { agentApi, flowApi, promptApi, shellApi } from '../api/electronApi';
import type { PromptInputAreaHandle } from '../components/chat/PromptInputArea';
import { markSendStopped, onStoppedPrompt, stopTargetFor } from '../utils/stoppedSends';
import type { StopTarget } from '../utils/stoppedSends';

function sendStop(target: StopTarget): Promise<boolean> {
  switch (target.kind) {
    case 'shell': return shellApi.stop(target.sendId);
    case 'agent': return agentApi.cancel(target.runId);
    case 'command': return flowApi.stopChatCommand(target.sendId);
    case 'chat': return promptApi.stop(target.sendId);
  }
}

/**
 * The composer's Stop for the open conversation: present while its newest send is unanswered.
 * The send ends by its own road (see `stoppedSends`); a stopped question comes back into the box.
 */
export function useComposerStop(promptAreaRef: RefObject<PromptInputAreaHandle | null>): (() => void) | undefined {
  // The stored turn itself (a stable reference); the target is derived from it on each render.
  const newest = useAppStore((s) => s.pendingTurns[s.selectedFile?.path ?? NEW_CONVERSATION_KEY]?.at(-1));
  const target = stopTargetFor(newest);
  const kind = target?.kind;
  const sendId = target?.sendId;
  const runId = target?.kind === 'agent' ? target.runId : undefined;

  useEffect(() => onStoppedPrompt((prompt) => promptAreaRef.current?.restoreDraft(prompt)), [promptAreaRef]);

  const stop = useCallback((): void => {
    if (!kind || !sendId) return;
    const named = (kind === 'agent' ? { kind, sendId, runId: runId ?? '' } : { kind, sendId }) as StopTarget;
    // A `!` command keeps its turn with whatever output it had: nothing comes back to the box.
    if (kind !== 'shell') markSendStopped(sendId);
    void sendStop(named).catch(() => false);
  }, [kind, sendId, runId]);

  return target ? stop : undefined;
}
