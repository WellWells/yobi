/**
 * Access-token candidates for LINE send/download. The scan runs inside the native core, off the
 * main thread; this module is the thin host-side façade.
 *
 * SECURITY: a token only ever flows into an outgoing send/download request. It is never logged,
 * printed, or written to disk. Candidates come back most-frequently-seen first (the live token is
 * re-sent constantly); the caller tries each until the server accepts one.
 */
import { LineError } from './errors';
import { nativeScanTokens } from './nativeLineCore';

export interface TokenScanDeps {
  platform?: NodeJS.Platform;
  /** Supplies token candidates in place of the native scan. */
  scan?: () => Promise<string[]>;
}

/**
 * Scans LINE's memory for access-token candidates (Windows only). Throws the LineError the
 * core reports: LINE_NOT_RUNNING, MEMORY_READ_FAILED, or TOKEN_NOT_FOUND when none were found.
 */
export async function extractAccessTokens(deps?: TokenScanDeps): Promise<string[]> {
  const platform = deps?.platform ?? process.platform;
  if (platform !== 'win32') throw new LineError('UNSUPPORTED_PLATFORM', 'Reading the LINE token is only available on Windows.');
  return deps?.scan ? deps.scan() : nativeScanTokens();
}
