import type { LinkSiteId } from '../../shared/linkSites/types';

/*
 * The Statistics page's Downloader counts, one per thing the person asked of it: a post forwarded
 * or saved, a video downloaded, or a link of a site it could not read. A Stop is not a use, and a
 * video's menu only offers the download the next run counts. `metrics.ts` sets the sink, so the
 * skills that count do not load the metrics store.
 */

type DownloadSink = (site: LinkSiteId, outcome: 'success' | 'failure') => void;

let sink: DownloadSink | null = null;

export function setDownloadSink(next: DownloadSink | null): void {
  sink = next;
}

function stopped(err: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');
}

/** Counts a failed use of `site`'s link, unless it was stopped. */
export function countDownloadFailure(site: LinkSiteId | null | undefined, err: unknown, signal?: AbortSignal): void {
  if (site && !stopped(err, signal)) sink?.(site, 'failure');
}

/**
 * Runs one use of `site`'s link and counts how it went; null `site` counts nothing, nor does a
 * result `isUse` turns away (a menu of a person's stories, which only offers the download).
 */
export async function countDownload<T>(
  site: LinkSiteId | null | undefined,
  signal: AbortSignal | undefined,
  work: () => Promise<T>,
  isUse: (result: T) => boolean = () => true,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (err) {
    countDownloadFailure(site, err, signal);
    throw err;
  }
  if (site && isUse(result)) sink?.(site, 'success');
  return result;
}
