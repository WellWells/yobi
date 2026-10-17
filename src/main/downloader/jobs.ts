import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DOWNLOADS_KEEP_MS } from '../../shared/downloads';
import type { VideoSiteId } from '../../shared/linkSites/types';
import type { DownloadKind, YtdlDestination } from '../../shared/ytdl';
import { currentDownloadsKeepMs, recordDownloads } from '../downloadsCache';
import { isInsideDir, ytdlDataDir } from '../youtubeDownload/paths';

/**
 * One folder per download under `<userData>/youtube-jobs`: yt-dlp's scratch space while it works,
 * then only the record of where the video was saved — kept as long as the download itself.
 * The folder keeps its shipped name whatever the site (factory reset deletes it by that name).
 */

/** What a finished job produced, kept in its folder so pressing the same button again reuses it. */
const RECORD_FILE = 'job.json';

export interface DownloadJobRecord {
  /** The site the video is on; absent = YouTube. */
  site?: VideoSiteId;
  videoId: string;
  /**
   * Which file of that id, when one id holds several (a bilibili page's part `p=2`); "" or absent
   * for a site with one video per id (YouTube).
   */
  variant?: string;
  /** What was downloaded: the video, or its sound alone (an MP3). Absent = video. */
  kind?: DownloadKind;
  /** `low`: a Telegram video with the low AAC (`YtdlChoice.lowAudio`). Absent = the usual best audio. */
  audio?: 'low';
  /** The video's lines (`720`), or the MP3's bitrate in kbps (`128`). */
  quality: number;
  destination: YtdlDestination;
  /** The whole video, in the downloads folder whatever the destination. */
  filePath: string;
  sizeBytes: number;
  /**
   * Not handed to a bot step when it was made: only saved on the computer (asked there, or too
   * large for Telegram then). A reuse decides again, by the size and what Telegram takes now.
   */
  savedLocally: boolean;
}

export function downloadJobsRoot(): string {
  return path.join(ytdlDataDir(), 'youtube-jobs');
}

export async function createDownloadJobDir(): Promise<string> {
  const dir = path.join(downloadJobsRoot(), randomBytes(8).toString('hex'));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Whether a job folder can go: a finished job's record lasts as long as Downloads/Yobi keeps
 * downloads (the setting; for good under "keep") and only while its files are intact — once they
 * are gone it can never be reused. A folder without a record is scratch from a run the app closed
 * on and goes after three days.
 */
async function jobFolderDone(dir: string, age: number, keepMs: number | null): Promise<boolean> {
  const record = await readJobRecord(dir);
  if (!record) return age >= DOWNLOADS_KEEP_MS;
  if (keepMs !== null && age >= keepMs) return true;
  return !(await recordFilesIntact(record).catch(() => false));
}

/** Removes the job folders nothing will use again (`jobFolderDone`); returns how many went. */
export async function cleanupDownloadJobs(now = Date.now()): Promise<number> {
  const root = downloadJobsRoot();
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const keepMs = currentDownloadsKeepMs();
  let removed = 0;
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory() || !(await jobFolderDone(dir, now - stat.mtimeMs, keepMs))) continue;
      await fs.rm(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // In use (Windows) or already gone: the next cleanup tries again.
    }
  }
  return removed;
}

/** Deletes one job folder, and only one inside the jobs root. */
export async function removeDownloadJobDir(dir: string): Promise<void> {
  const root = downloadJobsRoot();
  const full = path.resolve(dir);
  if (full === path.resolve(root) || !isInsideDir(root, full)) return;
  await fs.rm(full, { recursive: true, force: true });
}

export async function writeDownloadJobRecord(dir: string, record: DownloadJobRecord): Promise<void> {
  await fs.writeFile(path.join(dir, RECORD_FILE), JSON.stringify(record), 'utf8');
}

/**
 * A `job.json` as a record, or null when it is not one. Legacy `parts`/`partsBytes` fields are
 * dropped: the whole file beside them is what gets reused.
 */
function asRecord(value: unknown): DownloadJobRecord | null {
  if (!value || typeof value !== 'object') return null;
  const { parts: _parts, partsBytes: _partsBytes, ...r } = value as Partial<DownloadJobRecord> & { parts?: unknown; partsBytes?: unknown };
  if (r.site !== undefined && typeof r.site !== 'string') return null;
  if (r.variant !== undefined && typeof r.variant !== 'string') return null;
  if (r.kind !== undefined && typeof r.kind !== 'string') return null;
  if (r.audio !== undefined && r.audio !== 'low') return null;
  if (typeof r.videoId !== 'string' || typeof r.quality !== 'number' || typeof r.filePath !== 'string') return null;
  if (typeof r.sizeBytes !== 'number' || typeof r.savedLocally !== 'boolean') return null;
  if (r.destination !== 'telegram' && r.destination !== 'local') return null;
  return r as DownloadJobRecord;
}

/** The folder's `job.json`, or null: still at work, scratch left behind, or unreadable. */
async function readJobRecord(dir: string): Promise<DownloadJobRecord | null> {
  try {
    return asRecord(JSON.parse(await fs.readFile(path.join(dir, RECORD_FILE), 'utf8')));
  } catch {
    return null;
  }
}

/** The saved file is still there at its size. */
async function recordFilesIntact(record: DownloadJobRecord): Promise<boolean> {
  const stat = await fs.stat(record.filePath);
  return stat.isFile() && stat.size === record.sizeBytes;
}

/** What tells one download from another: the site, the video, which file of it, video or MP3, its audio, quality, destination. */
export type DownloadJobMatch = Pick<DownloadJobRecord, 'site' | 'videoId' | 'variant' | 'kind' | 'audio' | 'quality' | 'destination'> & {
  /** Only a download saved in this folder counts. */
  folder?: string;
};

/**
 * The site, variant, kind and audio a record or match stands for, with what old records lack
 * filled in: an MP3 is never handed out for a video of the same id, nor a video for an MP3, nor a
 * low-AAC video for one with the usual audio (or the other way round).
 */
export function downloadJobKey(r: Pick<DownloadJobRecord, 'site' | 'videoId' | 'variant' | 'kind' | 'audio'>): string {
  const key = [r.site ?? 'youtube', r.videoId, r.variant ?? '', r.kind ?? 'video'];
  return JSON.stringify(r.audio ? [...key, r.audio] : key);
}

function sameDownload(record: DownloadJobRecord, match: DownloadJobMatch): boolean {
  if (downloadJobKey(record) !== downloadJobKey(match)) return false;
  if (record.quality !== match.quality || record.destination !== match.destination) return false;
  return match.folder === undefined || path.dirname(path.resolve(record.filePath)) === path.resolve(match.folder);
}

/**
 * A finished download of this video (and part), as a video or an MP3, at this quality for this
 * destination whose file is still there at the size it was written (a file moved, deleted or
 * replaced does not count). Newest first; no older than Downloads/Yobi keeps downloads (the
 * setting, so a longer one does not save a second copy beside the kept file). A hit is reused, so
 * its folder is touched for the job cleanup and its files are noted again in the Downloads/Yobi
 * ledger: both keep it from now, not from when it was first downloaded.
 */
export async function findDownloadJob(
  match: DownloadJobMatch,
  now = Date.now(),
): Promise<{ dir: string; record: DownloadJobRecord } | null> {
  const root = downloadJobsRoot();
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const keepMs = currentDownloadsKeepMs();
  const hits: Array<{ dir: string; record: DownloadJobRecord; at: number }> = [];
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory() || (keepMs !== null && now - stat.mtimeMs >= keepMs)) continue;
      const record = await readJobRecord(dir);
      if (!record || !sameDownload(record, match)) continue;
      if (!(await recordFilesIntact(record))) continue;
      hits.push({ dir, record, at: stat.mtimeMs });
    } catch {
      // No record, unreadable, or its file is gone.
    }
  }
  const best = hits.sort((a, b) => b.at - a.at)[0];
  if (!best) return null;
  const touched = new Date(now);
  await fs.utimes(best.dir, touched, touched).catch(() => {});
  await recordDownloads([best.record.filePath], now).catch(() => {});
  return { dir: best.dir, record: best.record };
}
