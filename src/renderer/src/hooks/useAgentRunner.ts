import { startTransition, useCallback } from 'react';
import type { AgentCommandResult, AgentRunSummary } from '../../../shared/types';
import { attachmentMetaNames } from '../../../shared/conversationDoc';
import { useAppStore } from '../store/appStore';
import { agentApi, fileApi } from '../api/electronApi';
import { answeringRun, choiceAnswer, pendingQuestionFrom, useAgentRunStore } from '../store/useAgentRunStore';
import type { AgentChoicePick } from '../store/useAgentRunStore';
import { useCommandTurn } from './useCommandTurn';

/** Selects a resumed run's conversation; one that has since been deleted leaves the view as it is. */
async function openRunConversation(conversationPath: string | undefined): Promise<void> {
  if (!conversationPath) return;
  const store = useAppStore.getState();
  if (store.selectedFile?.path === conversationPath) return;
  const file = store.files.find((candidate) => candidate.path === conversationPath);
  if (!file) return;
  store.selectFile(file);
  const content = await fileApi.getContent(file.path);
  if (useAppStore.getState().selectedFile?.path !== file.path) return;
  startTransition(() => useAppStore.getState().setFileContent(content));
}

/** `onError` is what makes an agent failure visible; without it the pending bubble just vanishes. */
export function useAgentRunner(
  onError?: (message: string) => void,
  /** The run went online; the composer turns its web switch on to say so (see `usedWeb`). */
  onUsedWeb?: () => void,
) {
  const setResumable = useAgentRunStore((s) => s.setResumable);
  // `finish` clears the bubble and opens the result file.
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
   * a bubble to watch.
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
      if (res.usedWeb) onUsedWeb?.();
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
  }, [begin, finish, fail, onError, onUsedWeb, refreshResumable, trackQuestion]);

  const run = useCallback(async (
    goal: string,
    targetUrl: string,
    attachments: string[] = [],
    mcpServerIds: readonly string[] = [],
    // true on, false switched off by the user, undefined the default — where the agent may go online.
    web?: boolean,
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

  /**
   * Takes the banner's entry itself, since the banner has already emptied the resumable list. The
   * run goes back to its own conversation first, so the bubble sits under its earlier turns.
   */
  const resume = useCallback(async (entry: AgentRunSummary): Promise<void> => {
    await openRunConversation(entry.conversationPath);
    return track(entry.goal, entry.runId, [], () => agentApi.resume(entry.runId));
  }, [track]);

  /** A picked choice resumes the run that asked, by id, instead of going out as a typed chat message. */
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
