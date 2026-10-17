/**
 * Every file Yobi downloads for the user (YouTube videos, X media, `file_download`) lands in this
 * folder inside the computer's Downloads folder, unless the step names its own. The brand, not a
 * translated word: switching the app language must not start a second folder.
 */
export const DOWNLOADS_SUBFOLDER = 'Yobi';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Three days: how long Downloads/Yobi keeps a download unless the person chose otherwise, and how
 * long a download's scratch folder may sit before the job cleanup takes it.
 */
export const DOWNLOADS_KEEP_MS = 3 * DAY_MS;

/** How long Downloads/Yobi keeps what Yobi saved there (Settings › Downloader); `keep` deletes nothing. */
export const DOWNLOADS_KEEP_CHOICES = ['1d', '3d', '7d', 'keep'] as const;
export type DownloadsKeep = typeof DOWNLOADS_KEEP_CHOICES[number];

export const DEFAULT_DOWNLOADS_KEEP: DownloadsKeep = '3d';

const KEEP_DAYS = { '1d': 1, '3d': 3, '7d': 7 } as const;

export function isDownloadsKeep(value: unknown): value is DownloadsKeep {
  return typeof value === 'string' && (DOWNLOADS_KEEP_CHOICES as readonly string[]).includes(value);
}

/** Missing or unknown = the default, three days. */
export function normalizeDownloadsKeep(value: unknown): DownloadsKeep {
  return isDownloadsKeep(value) ? value : DEFAULT_DOWNLOADS_KEEP;
}

/** How long a download is kept under `choice`; `null` = never deleted. */
export function downloadsKeepMs(choice: DownloadsKeep): number | null {
  return choice === 'keep' ? null : KEEP_DAYS[choice] * DAY_MS;
}
