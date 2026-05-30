// src/renderer/src/hooks/useRewriteTask.ts
// Extracted rewrite task state machine from ChatView.
import { startTransition, useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { fileApi, promptApi } from '../api/electronApi';
import { findModelOption } from '../config/models';
import type { ExportToast } from './useCaptureExport';

function parseOutputTimestamp(name: string): number {
  const matched = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (!matched) return 0;
  const [, y, m, d, hh, mm, ss] = matched;
  const parsed = Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function useRewriteTask(setExportToast: (toast: ExportToast) => void) {
  const {
    selectedFile,
    fileContent,
    parsedBlocks,
    setFiles,
    selectFile,
    setFileContent,
    queue,
    duckaiModels,
  } = useAppStore();
  const { t } = useI18nStore();

  const [rewriteTaskId, setRewriteTaskId] = useState<string | null>(null);
  const [rewriteSourcePath, setRewriteSourcePath] = useState<string | null>(null);
  const [rewriteStartedAt, setRewriteStartedAt] = useState(0);

  // Watch queue for changes; auto-select the newly generated file when the task completes.
  useEffect(() => {
    if (!rewriteTaskId) return;
    const stillQueued = queue.items.some((item) => item.id === rewriteTaskId);
    if (stillQueued) return;

    let cancelled = false;
    const finalizeRewrite = async () => {
      try {
        const latest = await fileApi.getList();
        if (cancelled) return;
        setFiles(latest);
        const nextFile = latest.find((file) => {
          if (rewriteSourcePath && file.path === rewriteSourcePath) return false;
          if (!rewriteStartedAt) return true;
          return parseOutputTimestamp(file.name) >= rewriteStartedAt - 1_000;
        }) ?? null;
        if (!nextFile) return;

        const refreshed = await fileApi.getList();
        if (cancelled) return;
        setFiles(refreshed);
        const selected = refreshed.find((f) => f.path === nextFile.path) ?? nextFile;
        selectFile(selected);
        const content = await fileApi.getContent(selected.path);
        if (cancelled) return;
        startTransition(() => setFileContent(content));
      } finally {
        if (!cancelled) {
          setRewriteTaskId(null);
          setRewriteSourcePath(null);
          setRewriteStartedAt(0);
        }
      }
    };
    void finalizeRewrite();
    return () => { cancelled = true; };
  }, [queue.items, rewriteTaskId, rewriteSourcePath, rewriteStartedAt, selectFile, setFileContent, setFiles]);

  const startRewrite = useCallback(async (nextUrl: string) => {
    if (!selectedFile || !fileContent) return;
    const prompt = parsedBlocks?.prompt?.trim() || fileContent.trim();
    const modelLabel = findModelOption(nextUrl, duckaiModels).label;
    const taskId = await promptApi.triggerWithOptions({ prompt, targetUrl: nextUrl });
    if (!taskId) {
      setExportToast({ id: Date.now(), message: t('rewrite.enqueueFailed') });
      return;
    }
    setRewriteTaskId(taskId);
    setRewriteSourcePath(selectedFile.path);
    setRewriteStartedAt(Date.now());
    setExportToast({
      id: Date.now(),
      message: t('rewrite.queued').replace('{{model}}', modelLabel),
    });
  }, [selectedFile, fileContent, parsedBlocks, t, setExportToast, duckaiModels]);

  return { startRewrite };
}
