/**
 * line_preview: a chat's locally cached media (image thumbnails and video poster frames),
 * decrypted with each message's keyMaterial and saved. Offline: LINE caches only medium-resolution thumbnails; originals
 * and shared files live on LINE's server (status server_only — line_download gets those).
 */
import { readFile } from 'node:fs/promises';
import { decryptE2EEFile } from './lineE2eeFile';
import { ensureOutputDir, errorText, previewFileName, writeMediaFile } from './lineMediaFiles';
import { omitEmpty, previewJobs, type MediaSource, type PreviewJob, type PreviewQuery, type PreviewResult } from './lineMediaRows';

export interface PreviewDeps {
  /** Downloads/Yobi/previews; created only when a thumbnail is saved. */
  dir: string;
  /** Notes the saved files for the Downloads/Yobi cleanup. */
  record: (files: string[]) => Promise<void>;
}

async function saveThumbnail(job: PreviewJob, folder: () => Promise<string>, saved: string[]): Promise<PreviewResult> {
  let blob: Buffer;
  try {
    blob = await readFile(job.thumbPath);
  } catch {
    return { ...job.res, status: 'not_cached', note: 'thumbnail evicted from cache' };
  }
  let plain: Buffer;
  try {
    plain = decryptE2EEFile(job.keyMaterial, blob);
  } catch (err) {
    return { ...job.res, status: 'not_cached', note: `decrypt failed: ${errorText(err)}` };
  }
  const written = await writeMediaFile(await folder(), previewFileName(job.res.sent_at ?? '', job.res.id, plain), plain);
  if (written.failure) return { ...job.res, status: 'write_failed', note: written.failure };
  saved.push(written.path);
  const note = job.ct === 2 ? 'video poster thumbnail (not the full clip)' : '';
  return { ...job.res, status: 'saved', saved_as: written.path, bytes: plain.length, note };
}

/** Saves a chat's cached thumbnails, oldest first; rows with nothing cached say why. */
export async function runPreview(src: MediaSource, q: PreviewQuery, deps: PreviewDeps): Promise<PreviewResult[]> {
  const jobs = previewJobs(src, q);
  let dir: string | null = null;
  const folder = async (): Promise<string> => (dir ??= await ensureOutputDir(deps.dir));
  const out: PreviewResult[] = [];
  const saved: string[] = [];
  for (const job of jobs) {
    out.push(omitEmpty(job.pending ? await saveThumbnail(job, folder, saved) : job.res));
  }
  if (saved.length > 0) await deps.record(saved).catch(() => undefined);
  return out;
}
