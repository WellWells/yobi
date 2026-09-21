import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { flowApi } from '../api/electronApi';
import { useCommandTurn } from './useCommandTurn';
import type { ChatCommand } from './useChatCommands';
import type { ExportToast } from './useCaptureExport';

export function useChatCommandRunner(setToast: (toast: ExportToast) => void) {
  const { t } = useI18nStore();
  const { begin, finish, fail } = useCommandTurn();

  const failToast = useCallback((command: string, error: string): void => {
    setToast({
      id: Date.now(),
      message: t('chat.command.error').replace('{{command}}', command).replace('{{error}}', error),
    });
  }, [setToast, t]);

  const doneToast = useCallback((command: string): void => {
    setToast({ id: Date.now(), message: t('chat.command.done').replace('{{command}}', command) });
  }, [setToast, t]);

  const runCommand = useCallback(async (cmd: ChatCommand, input: string): Promise<void> => {
    const conversationPath = useAppStore.getState().selectedFile?.path;

    const sendId = begin(input);
    try {
      const { result, filePath } = await flowApi.runChatCommand(cmd.flowId, cmd.command, input, conversationPath);
      if (!result.success) {
        fail(sendId);
        failToast(cmd.command, result.error ?? '');
        return;
      }
      await finish(sendId, filePath);
      if (!filePath) doneToast(cmd.command);
    } catch (err: unknown) {
      fail(sendId);
      failToast(cmd.command, err instanceof Error ? err.message : String(err));
    }
  }, [begin, finish, fail, failToast, doneToast, setToast, t]);

  return { runCommand };
}
