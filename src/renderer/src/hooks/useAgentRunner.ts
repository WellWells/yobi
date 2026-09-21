import { useCallback } from 'react';
import type { AgentCommandResult } from '../../../shared/types';
import { attachmentMetaNames } from '../../../shared/conversationDoc';
import { useAppStore } from '../store/appStore';
import { agentApi } from '../api/electronApi';
import { answeringRun, choiceAnswer, pendingQuestionFrom, useAgentRunStore } from '../store/useAgentRunStore';
import type { AgentChoicePick } from '../store/useAgentRunStore';
import { useCommandTurn } from './useCommandTurn';

/**
 * `onError` is what makes an agent failure visible. Without it the pending bubble just vanishes:
 * `AgentCommandResult.error` was dropped on the floor, so a connector command that cannot run
 * (server disconnected, model cannot carry the tool list) looked like nothing happened at all.
 */
export function useAgentRunner(onError?: (message: string) => void) {
  const setResumable = useAgentRunStore((s) => s.setResumable);
  // `finish` opens the result file as well as clearing the bubble, which is why resuming no
  // longer needs its own copy of that.
  const { begin, finish, fail } = useCommandTurn();

  const refreshResumable = useCallback(async (): Promise<void> => {
    setResumable(await agentApi.listResumable());
  }, [setResumable]);

  const trackQuestion = useCallback((
    res: AgentCommandResult,
    runId: string,
    mcpServerIds?: readonly string[],
  ): void => {
    useAgentRunStore.getState().setPendingQuestion(pendingQuestionFrom(res, runId, mcpServerIds));
  }, []);

  /**
   * Every way of starting agent work goes through here, so none of them can start one without
   * a bubble to watch. Resuming from the banner used to skip it: the banner disappeared, the
   * trace events arrived and were applied to the store, and nothing on screen rendered them —
   * an empty conversation for however many minutes the run took.
   */
  const track = useCallback(async (
    goal: string,
    runId: string,
    attachments: string[],
    call: () => Promise<AgentCommandResult>,
    mcpServerIds?: readonly string[],
  ): Promise<void> => {
    const sendId = begin(goal, runId, attachmentMetaNames(attachments));
    try {
      const res = await call();
      trackQuestion(res, runId, mcpServerIds);
      if (res.success) await finish(sendId, res.filePath);
      else {
        fail(sendId);
        if (res.error) onError?.(res.error);
      }
    } catch (err: unknown) {
      fail(sendId);
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      await refreshResumable();
    }
  }, [begin, finish, fail, onError, refreshResumable, trackQuestion]);

  const run = useCallback(async (
    goal: string,
    targetUrl: string,
    attachments: string[] = [],
    mcpServerIds: readonly string[] = [],
    web = true,
  ): Promise<void> => {
    const conversationPath = useAppStore.getState().selectedFile?.path;
    // The pending question is matched on its disclosed set too, so an answer typed while Notion
    // is on the table answers the question Notion asked, and plain agent mode never inherits a
    // connector scope the user did not name.
    const answering = answeringRun(
      useAgentRunStore.getState().pendingQuestion,
      conversationPath ?? '',
      mcpServerIds,
    );
    const runId = answering?.runId ?? crypto.randomUUID();
    const sending = answering ? [] : attachments;
    // Empty means "nothing disclosed" and must reach main as undefined: an empty array filters
    // every server out, which is a different — and silent — thing.
    const scope = mcpServerIds.length > 0 ? [...mcpServerIds] : undefined;
    return track(goal, runId, sending, () => (answering
      ? agentApi.resume(runId, goal)
      : agentApi.run(goal, targetUrl, runId, conversationPath, sending, scope, web)), mcpServerIds);
  }, [track]);

  const resume = useCallback(async (runId: string): Promise<void> => {
    const goal = useAgentRunStore.getState().resumable.find((entry) => entry.runId === runId)?.goal ?? '';
    return track(goal, runId, [], () => agentApi.resume(runId));
  }, [track]);

  /**
   * A picked choice answers the run that asked, by id. It used to go out like a typed message, so a
   * plain chat model received it — and confirmed an action nothing had done — while the run stayed
   * parked on its question.
   */
  const answer = useCallback(async (pick: AgentChoicePick): Promise<void> => {
    const pending = choiceAnswer(useAgentRunStore.getState().pendingQuestion, pick);
    if (!pending) return;
    // Cleared before the call, so a second click cannot resume the same run twice.
    useAgentRunStore.getState().setPendingQuestion(null);
    return track(pick.text, pick.runId, [], () => agentApi.resume(pick.runId, pick.text), pending.mcpServerIds);
  }, [track]);

  const discard = useCallback(async (runId: string): Promise<void> => {
    const pending = useAgentRunStore.getState().pendingQuestion;
    if (pending?.runId === runId) useAgentRunStore.getState().setPendingQuestion(null);
    await agentApi.discard(runId);
    await refreshResumable();
  }, [refreshResumable]);

  return { run, resume, answer, discard };
}
