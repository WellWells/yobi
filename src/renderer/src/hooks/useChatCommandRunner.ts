import { startTransition, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { flowApi, fileApi } from '../api/electronApi';
import type { ChatCommand } from './useChatCommands';
import type { ExportToast } from './useCaptureExport';

export function useChatCommandRunner(setToast: (toast: ExportToast) => void) {
  const { setFiles, selectFile, setFileContent } = useAppStore(
    useShallow((s) => ({
      setFiles: s.setFiles,
      selectFile: s.selectFile,
      setFileContent: s.setFileContent,
    })),
  );
  const { t } = useI18nStore();
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  const runCommand = useCallback(async (cmd: ChatCommand, input: string): Promise<void> => {
    setRunningCommand(cmd.command);
    try {
      const { result, filePath } = await flowApi.runChatCommand(cmd.flowId, cmd.command, input);
      if (!result.success) {
        setToast({
          id: Date.now(),
          message: t('chat.command.error').replace('{{command}}', cmd.command).replace('{{error}}', result.error ?? ''),
        });
        return;
      }
      if (!filePath) {
        setToast({ id: Date.now(), message: t('chat.command.done').replace('{{command}}', cmd.command) });
        return;
      }
      const latest = await fileApi.getList();
      setFiles(latest);
      const file = latest.find((f) => f.path === filePath) ?? null;
      if (file) {
        selectFile(file);
        const content = await fileApi.getContent(file.path);
        startTransition(() => setFileContent(content));
      }
      setToast(null);
    } catch (err: unknown) {
      setToast({
        id: Date.now(),
        message: t('chat.command.error')
          .replace('{{command}}', cmd.command)
          .replace('{{error}}', err instanceof Error ? err.message : String(err)),
      });
    } finally {
      setRunningCommand(null);
    }
  }, [setToast, t, setFiles, selectFile, setFileContent]);

  return { runCommand, runningCommand };
}
