import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { fileApi } from '../../api/electronApi';
import { useI18nStore } from '../../store/i18nStore';
import { useExportSettingsStore } from '../../store/exportSettingsStore';
import { parseConversationDoc } from '../../../../shared/conversationDoc';
import { fillTemplate as fill } from '../../../../shared/fillTemplate';
import type { BatchCaptureFormat, BatchCaptureItem, BatchCaptureResult, OutputFile } from '../../../../shared/types';
import { conversationAliases, parseMarkdownBlocks } from '../../utils/parseMarkdownBlocks';
import { captureLookFrom, conversationCaptureRequest } from '../../hooks/conversationCapture';

export type BatchExportState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number; stopping: boolean }
  | {
    phase: 'result';
    level: 'success' | 'warning' | 'error';
    message: string;
    /** Names of the conversations that did not export, for the user to find. */
    details: string[];
    /** What "Show folder" opens: the export folder itself, or the zip selected in its folder. */
    reveal?: { kind: 'folder' | 'file'; path: string };
  };

type Translate = (key: string) => string;

function batchResultState(result: BatchCaptureResult, format: BatchCaptureFormat, t: Translate): BatchExportState {
  if (result.status === 'canceled') return { phase: 'idle' };
  if (result.status === 'busy') return { phase: 'result', level: 'error', message: t('batchExport.busy'), details: [] };
  const reveal = result.folder ? { kind: 'folder' as const, path: result.folder } : undefined;
  const count = String(result.saved);
  if (result.status === 'stopped') {
    return { phase: 'result', level: 'warning', message: fill(t('batchExport.stopped'), { count }), details: [], reveal };
  }
  if (result.failed.length === 0) {
    return { phase: 'result', level: 'success', message: fill(t('batchExport.done'), { count }), details: [], reveal };
  }
  const tooTall = result.failed.filter((failure) => failure.reason === 'tooTall').length;
  const parts = [fill(t('batchExport.partial'), { count, failed: String(result.failed.length) })];
  if (tooTall > 0 && format === 'png') parts.push(fill(t('batchExport.tooTall'), { count: String(tooTall) }));
  return {
    phase: 'result',
    level: result.saved > 0 ? 'warning' : 'error',
    message: parts.join(' '),
    details: result.failed.map((failure) => failure.name),
    reveal: result.saved > 0 ? reveal : undefined,
  };
}

/**
 * The sidebar's batch actions on the checked conversations: zip the files as they are, or
 * render each one as a PDF/PNG card. The cards use the saved Card style and the whole
 * conversation, built by the same function the export dialog uses.
 */
export function useBatchExport() {
  const { t, locale } = useI18nStore(useShallow((s) => ({ t: s.t, locale: s.locale })));
  const loadExportSettings = useExportSettingsStore((s) => s.load);
  const [state, setState] = useState<BatchExportState>({ phase: 'idle' });
  const runningRef = useRef(false);

  useEffect(() => fileApi.onBatchCaptureProgress((progress) => {
    setState((prev) => (prev.phase === 'running' ? { ...prev, done: progress.done, total: progress.total } : prev));
  }), []);

  const exportCards = useCallback(async (format: BatchCaptureFormat, files: OutputFile[]) => {
    if (runningRef.current || files.length === 0) return;
    runningRef.current = true;
    setState({ phase: 'running', done: 0, total: files.length, stopping: false });
    try {
      await loadExportSettings();
      const capture = useExportSettingsStore.getState().capture;
      const look = captureLookFrom(capture);
      const items: BatchCaptureItem[] = [];
      for (const file of files) {
        const content = await fileApi.getContent(file.path);
        if (content === null) continue;
        const blocks = parseMarkdownBlocks(content);
        const conversation = parseConversationDoc(content, conversationAliases());
        const title = blocks.title || file.preview || file.name.replace(/\.md$/i, '');
        items.push({
          name: title,
          fileStem: title,
          request: conversationCaptureRequest(
            { content, blocks, conversation, title, fileName: title },
            // A batch exports whole conversations: "last turn only" is a choice made for one
            // conversation in the dialog, not something to apply silently to every file.
            { look, format, range: 'all', showPrompt: capture.showPrompt, locale, t },
          ),
        });
      }
      const result = await fileApi.batchCapture(format, items);
      setState(batchResultState(result, format, t));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setState({ phase: 'result', level: 'error', message: fill(t('batchExport.failed'), { error }), details: [] });
    } finally {
      runningRef.current = false;
    }
  }, [loadExportSettings, locale, t]);

  const exportZip = useCallback(async (files: OutputFile[]) => {
    if (runningRef.current || files.length === 0) return;
    const result = await fileApi.exportZip(files.map((file) => file.path));
    if (result.canceled) return;
    if (!result.ok || !result.filePath) {
      const message = result.error
        ? fill(t('batchExport.zipFailed'), { error: result.error })
        : t('batchExport.zipNothing');
      setState({ phase: 'result', level: 'error', message, details: [] });
      return;
    }
    setState({
      phase: 'result',
      level: 'success',
      message: fill(t('batchExport.zipDone'), { count: String(result.count ?? files.length) }),
      details: [],
      reveal: { kind: 'file', path: result.filePath },
    });
  }, [t]);

  const stop = useCallback(() => {
    setState((prev) => (prev.phase === 'running' ? { ...prev, stopping: true } : prev));
    void fileApi.stopBatchCapture();
  }, []);

  const dismiss = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, running: state.phase === 'running', exportCards, exportZip, stop, dismiss };
}
