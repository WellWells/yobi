import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { flowApi } from '../api/electronApi';
import { isUntypedBuiltinCommand } from '../../../shared/imageRequest';
import { useCommandTurn } from './useCommandTurn';
import type { ChatCommand } from './useChatCommands';
import type { ExportToast } from './useCaptureExport';
import { fillTemplate } from '../../../shared/fillTemplate';

export function useChatCommandRunner(setToast: (toast: ExportToast) => void) {
  const { t } = useI18nStore();
  const { begin, finish, fail } = useCommandTurn();

  // A pasted link's built-in was never typed as a command: its failure is said in its own words.
  const failToast = useCallback((command: string, error: string): void => {
    setToast({
      message: isUntypedBuiltinCommand(command)
        ? error
        : fillTemplate(t('chat.command.error'), { command, error }),
      level: 'error',
    });
  }, [setToast, t]);

  const doneToast = useCallback((command: string): void => {
    setToast({ message: fillTemplate(t('chat.command.done'), { command }), level: 'success' });
  }, [setToast, t]);

  const runCommand = useCallback(async (cmd: ChatCommand, input: string): Promise<void> => {
    const { selectedFile, aiUrl } = useAppStore.getState();
    const conversationPath = selectedFile?.path;
    // A pasted link's built-in (analyze, a video summary) answers on the model the chat has picked;
    // a picture is drawn on it when it is a page that draws.
    const modelUrl = isUntypedBuiltinCommand(cmd.flowId) ? aiUrl : undefined;

    const sendId = begin(input, undefined, undefined, true);
    const stopProgress = flowApi.onChatCommandProgress(({ progressId, progress }) => {
      if (progressId === sendId) useAppStore.getState().setPendingTurnProgress(sendId, progress);
    });
    try {
      const { result, filePath } = await flowApi.runChatCommand(cmd.flowId, cmd.command, input, conversationPath, sendId, modelUrl);
      if (!result.success) {
        fail(sendId);
        failToast(cmd.command, result.displayError ?? result.error ?? '');
        return;
      }
      await finish(sendId, filePath);
      if (!filePath && !isUntypedBuiltinCommand(cmd.flowId)) doneToast(cmd.command);
    } catch (err: unknown) {
      fail(sendId);
      failToast(cmd.command, err instanceof Error ? err.message : String(err));
    } finally {
      stopProgress();
    }
  }, [begin, finish, fail, failToast, doneToast, setToast, t]);

  return { runCommand };
}
