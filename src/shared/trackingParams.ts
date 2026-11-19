/**
 * Parameters a share or an ad click adds to a link; the page is the same without them. Facebook's
 * app adds `mibextid` to every link shared from it, Google's shopping results `srsltid`, Instagram
 * `igshid`. Short names a site may use for itself (X's `s`, YouTube's `si`) are left alone.
 */
const TRACKING_PARAM = /^(?:utm_|fbclid$|gclid$|msclkid$|mibextid$|srsltid$|igshid$)/i;

/** Drops the tracking parameters from `url` in place. */
export function dropTrackingParams(url: URL): void {
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
  }
}
