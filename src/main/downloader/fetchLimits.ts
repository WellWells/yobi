import * as fs from 'node:fs/promises';
import type { FetchLimit } from './streamTypes';

/*
 * How many bytes a download Yobi fetches itself may receive. A playlist or manifest only
 * declares sizes (`BANDWIDTH` × the summed `#EXTINF`), and whoever serves it decides what the
 * segments really hold: the menu's estimate, the person's limit and the free-space check all read
 * the declaration, so the bytes as they arrive are held to a `FetchLimit` as well — the person's
 * size limit (a capped bot user) and what the disk can take, whichever is smaller.
 */

/** The streams, the merged file and the copy to another volume can all exist at once. */
export const SPACE_FACTOR = 2.5;

/**
 * Streams put into one MP4 come out a little smaller (TS packets carry about 2–10 % of headers
 * over MP4's): a capped person's streams may run this much over their limit before the download
 * stops, and the finished file is still checked against the limit itself.
 */
export const STREAM_SLACK = 1.25;

/** The bytes free for this user on `dir`'s volume; null when the volume cannot be read. */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    const stats = await fs.statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/** A capped person's limit for streams that get put together: `limitBytes` with the container's slack. */
export function streamCapBytes(limitBytes: number): number {
  return Math.ceil(limitBytes * STREAM_SLACK);
}

/** The tighter of a size cap and the disk's ceiling, remembering which one it was; null when neither applies. */
export function pickFetchLimit(capBytes: number | null, diskBytes: number | null): FetchLimit | null {
  if (diskBytes !== null && (capBytes === null || diskBytes < capBytes)) return { bytes: diskBytes, disk: true };
  return capBytes === null ? null : { bytes: capBytes, disk: false };
}

/**
 * The limit for a download into `dir`: `capBytes` (null = none) and the most the disk can take
 * while it keeps room for the file made of it and its copy (free space ÷ `SPACE_FACTOR`, the rule
 * `youtube_download` applies to the estimate before starting).
 */
export async function fetchLimitFor(dir: string, capBytes: number | null): Promise<FetchLimit | null> {
  const free = await freeDiskBytes(dir);
  return pickFetchLimit(capBytes, free === null ? null : Math.floor(free / SPACE_FACTOR));
}
