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

/**
 * The largest file, in MB, a bot user without the admin right may download (Settings ›
 * Downloader); `none` leaves only what the chat itself takes.
 */
export const BOT_DOWNLOAD_CAP_CHOICES = ['50', '100', '200', '500', 'none'] as const;
export type BotDownloadCap = typeof BOT_DOWNLOAD_CAP_CHOICES[number];

export const DEFAULT_BOT_DOWNLOAD_CAP: BotDownloadCap = '100';

export function isBotDownloadCap(value: unknown): value is BotDownloadCap {
  return typeof value === 'string' && (BOT_DOWNLOAD_CAP_CHOICES as readonly string[]).includes(value);
}

/** Missing or unknown = the default, 100 MB: never "no limit". */
export function normalizeBotDownloadCap(value: unknown): BotDownloadCap {
  return isBotDownloadCap(value) ? value : DEFAULT_BOT_DOWNLOAD_CAP;
}

/** The cap under `choice` in bytes; `null` = Yobi sets none. */
export function botDownloadCapBytes(choice: BotDownloadCap): number | null {
  return choice === 'none' ? null : Number(choice) * 1_000_000;
}

/** One account's own cap is stored under this key: the platform and the account id on it. */
export function botDownloadCapKey(platform: string, userId: string): string {
  return `${platform}:${userId}`;
}

const MAX_ACCOUNT_CAPS = 5_000;

/**
 * The caps the owner set for single accounts, over the one for everyone (`botDownloadCap`): valid
 * choices only, under a `<platform>:<id>` key. An account with no entry follows the general cap.
 */
export function normalizeBotDownloadCaps(raw: unknown): Record<string, BotDownloadCap> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const caps: Record<string, BotDownloadCap> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_ACCOUNT_CAPS)) {
    if (/^[A-Za-z]+:[\w.-]{1,128}$/.test(key) && isBotDownloadCap(value)) caps[key] = value;
  }
  return caps;
}

/** How long a download is kept under `choice`; `null` = never deleted. */
export function downloadsKeepMs(choice: DownloadsKeep): number | null {
  return choice === 'keep' ? null : KEEP_DAYS[choice] * DAY_MS;
}
