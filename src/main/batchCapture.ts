import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BatchCaptureFailure,
  BatchCaptureItem,
  BatchCaptureProgress,
  MarkdownCaptureRequest,
} from '../shared/types';

/**
 * How many capture windows render at once. Each is its own Chromium renderer, so more lanes cost
 * memory as well as cores; past three they mostly wait on the same GPU and disk.
 */
export const BATCH_CAPTURE_CONCURRENCY = 3;

/** Upper bound on one request, so a renderer bug cannot ask main to open thousands of windows. */
export const BATCH_CAPTURE_MAX_ITEMS = 500;

export interface BatchCaptureDeps {
  capture: (request: MarkdownCaptureRequest, signal: AbortSignal) => Promise<{ buffer: Buffer; ext: string }>;
  write: (fileStem: string, ext: string, buffer: Buffer) => Promise<string>;
  isTooTall: (err: unknown) => boolean;
  onProgress: (progress: BatchCaptureProgress) => void;
  signal: AbortSignal;
  concurrency?: number;
}

export interface BatchCaptureOutcome {
  saved: string[];
  failed: BatchCaptureFailure[];
  stopped: boolean;
}

/**
 * Renders and writes each item, a few at a time. One failure never ends the batch — a
 * conversation too tall for PNG is reported by name and the rest still export. Stopping
 * aborts the windows in flight (their renders are dropped, nothing half-written is kept)
 * and starts no new ones; files already written stay.
 */
export async function runBatchCapture(
  items: readonly BatchCaptureItem[],
  deps: BatchCaptureDeps,
): Promise<BatchCaptureOutcome> {
  const saved: string[] = [];
  const failed: BatchCaptureFailure[] = [];
  const total = items.length;
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (!deps.signal.aborted && next < total) {
      const item = items[next];
      next += 1;
      try {
        const result = await deps.capture(item.request, deps.signal);
        if (deps.signal.aborted) return;
        saved.push(await deps.write(item.fileStem, result.ext, result.buffer));
      } catch (err) {
        if (deps.signal.aborted) return;
        failed.push(deps.isTooTall(err)
          ? { name: item.name, reason: 'tooTall' }
          : { name: item.name, reason: 'error', detail: err instanceof Error ? err.message : String(err) });
      }
      done += 1;
      deps.onProgress({ done, total, failed: failed.length });
    }
  };

  const lanes = Math.max(1, Math.min(deps.concurrency ?? BATCH_CAPTURE_CONCURRENCY, total));
  await Promise.all(Array.from({ length: lanes }, worker));
  return { saved, failed, stopped: deps.signal.aborted };
}

/**
 * Writes without overwriting: `name.pdf`, then `name (2).pdf`… Exclusive create rather than a
 * look-then-write, because several lanes may be naming files in the same folder at once and
 * two conversations can share a title.
 */
export async function writeUniqueFile(dir: string, stem: string, ext: string, data: Buffer): Promise<string> {
  for (let idx = 1; ; idx += 1) {
    const candidate = path.join(dir, `${idx === 1 ? stem : `${stem} (${idx})`}.${ext}`);
    try {
      await fs.writeFile(candidate, data, { flag: 'wx' });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/** A zip entry name not yet taken, compared case-insensitively (Windows and macOS extract that way). */
export function uniqueEntryName(taken: Set<string>, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let idx = 1; ; idx += 1) {
    const candidate = idx === 1 ? fileName : `${stem} (${idx})${ext}`;
    if (taken.has(candidate.toLowerCase())) continue;
    taken.add(candidate.toLowerCase());
    return candidate;
  }
}
