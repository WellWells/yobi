import { startTransition, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AgentCommandResult } from '../../../shared/types';
import { useAppStore } from '../store/appStore';
import { agentApi, fileApi } from '../api/electronApi';
import { answeringRun, useAgentRunStore } from '../store/useAgentRunStore';
import { useCommandTurn } from './useCommandTurn';

export function useAgentRunner() {
  const { setFiles, selectFile, setFileContent } = useAppStore(
    useShallow((s) => ({ setFiles: s.setFiles, selectFile: s.selectFile, setFileContent: s.setFileContent })),
  );
  const setResumable = useAgentRunStore((s) => s.setResumable);
  const { begin, finish, fail } = useCommandTurn();

  const openResult = useCallback(async (filePath?: string): Promise<void> => {
    if (!filePath) return;
    const latest = await fileApi.getList();
    setFiles(latest);
    const file = latest.find((f) => f.path === filePath) ?? null;
    if (file) {
      selectFile(file);
      const content = await fileApi.getContent(file.path);
      startTransition(() => setFileContent(content));
    }
  }, [setFiles, selectFile, setFileContent]);

  const refreshResumable = useCallback(async (): Promise<void> => {
    setResumable(await agentApi.listResumable());
  }, [setResumable]);

  /**
   * Arms (or disarms) the pending question. A question lands in the conversation the run
   * just wrote to, which for a run started from a blank chat is a file that did not exist
   * when it began — so the path comes back with the result rather than from before the run.
   */
  const trackQuestion = useCallback((res: AgentCommandResult, runId: string): void => {
    useAgentRunStore.getState().setPendingQuestion(
      res.success && res.question
        ? { runId, conversationPath: res.filePath ?? '', question: res.question }
        : null,
    );
  }, []);

  const run = useCallback(async (goal: string, targetUrl: string): Promise<void> => {
    const conversationPath = useAppStore.getState().selectedFile?.path;
    // The agent asked something in this very conversation, so this message is the answer:
    // resume that run — every observation it already gathered is still on disk — rather
    // than starting the goal over from nothing.
    const answering = answeringRun(useAgentRunStore.getState().pendingQuestion, conversationPath ?? '');
    const runId = answering?.runId ?? crypto.randomUUID();
    const sendId = begin(goal, runId);
    try {
      const res = answering
        ? await agentApi.resume(runId, goal)
        : await agentApi.run(goal, targetUrl, runId, conversationPath);
      trackQuestion(res, runId);
      if (res.success) await finish(sendId, res.filePath);
      else fail(sendId);
    } catch {
      fail(sendId);
    } finally {
      await refreshResumable();
    }
  }, [begin, finish, fail, refreshResumable, trackQuestion]);

  const resume = useCallback(async (runId: string): Promise<void> => {
    try {
      const res = await agentApi.resume(runId);
      trackQuestion(res, runId);
      if (res.success) await openResult(res.filePath);
    } finally {
      await refreshResumable();
    }
  }, [openResult, refreshResumable, trackQuestion]);

  const discard = useCallback(async (runId: string): Promise<void> => {
    const pending = useAgentRunStore.getState().pendingQuestion;
    if (pending?.runId === runId) useAgentRunStore.getState().setPendingQuestion(null);
    await agentApi.discard(runId);
    await refreshResumable();
  }, [refreshResumable]);

  return { run, resume, discard };
}
