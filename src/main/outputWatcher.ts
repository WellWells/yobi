import { watch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import { IPC } from '../shared/types';
import { getOutputDir } from './files';
import { sendLog, sendToRenderer } from './helpers';

/*
 * Conversations are plain .md files the user may edit in another app. The renderer re-reads on
 * each event and compares, so Yobi's own writes cost only a list read.
 */

export const OUTPUT_WATCH_DEBOUNCE_MS = 300;
const OUTPUT_WATCH_RETRY_MS = 5_000;

/**
 * A change worth a re-read: a visible .md. `atomicWrite` stages `.<name>.<pid>-<n>.tmp` beside
 * the target, and editors keep their own dot/backup files; the rename onto the .md is the event
 * that counts. A missing filename (some platforms omit it) is treated as "something changed".
 */
export function isConversationFileEvent(filename: string | null): boolean {
  if (filename === null) return true;
  const base = path.basename(filename);
  return !base.startsWith('.') && /\.md$/i.test(base);
}

type WatchOptions = { debounceMs?: number; retryMs?: number; onError?: (err: unknown) => void };

/**
 * Watches `resolveDir()` recursively and calls `onChange` once per burst of .md changes (one
 * answer is several back-to-back writes). On a watcher error — the folder deleted or moved
 * under it — it closes and starts over after `retryMs`, resolving the folder again.
 */
export function watchOutputDir(
  resolveDir: () => Promise<string>,
  onChange: () => void,
  options: WatchOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? OUTPUT_WATCH_DEBOUNCE_MS;
  const retryMs = options.retryMs ?? OUTPUT_WATCH_RETRY_MS;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!stopped) onChange();
    }, debounceMs);
  };

  const restartLater = (err: unknown) => {
    watcher?.close();
    watcher = null;
    options.onError?.(err);
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      void start();
    }, retryMs);
  };

  const start = async () => {
    try {
      const dir = await resolveDir();
      if (stopped) return;
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (isConversationFileEvent(filename === null ? null : String(filename))) schedule();
      });
      watcher.on('error', restartLater);
    } catch (err: unknown) {
      restartLater(err);
    }
  };

  void start();
  return () => {
    stopped = true;
    if (debounce) clearTimeout(debounce);
    if (retry) clearTimeout(retry);
    watcher?.close();
    watcher = null;
  };
}

export function startOutputFileWatch(): () => void {
  return watchOutputDir(
    getOutputDir,
    () => sendToRenderer(IPC.OUTPUT_FILES_CHANGED),
    {
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        sendLog(`⚠️ Outputs folder watch stopped (${message}) — retrying`);
      },
    },
  );
}
