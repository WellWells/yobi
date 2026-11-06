/**
 * line_download: message attachments fetched from LINE's server and decrypted with each message's
 * keyMaterial. The access token comes from LINE's memory and only goes into the native request: it
 * is never returned, logged or written anywhere.
 *
 * The fetch and the file decryption are one native-core call; this module keeps the orchestration:
 * which rows are fetched, the token reuse and skip-after-rejection rules, file names and statuses.
 * The native call, token scan, clock, pause and save folder are injected, so the run is tested
 * offline.
 */
import { open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NativeClientEnv } from './nativeContract';
import { LineError } from './errors';
import { downloadFileName, ensureOutputDir, errorText, placeDownload } from './lineMediaFiles';
import { downloadJobs, omitEmpty, type DownloadJob, type DownloadQuery, type DownloadResult, type MediaSource } from './lineMediaRows';
import type { NativeDownloadRequest, NativeDownloadResult } from './nativeContract';

// How many token candidates one run tries before giving up.
const MAX_TOKEN_TRIES = 12;
const OBS_PAUSE_MS = 200;
const MAX_BODY_BYTES = 256 * 1024 * 1024;
// Starts an error when Windows refused the connection before it was made.
const NET_BLOCKED = 'connection blocked: ';

export interface DownloadDeps {
  /** Access-token candidates from LINE's memory, most-frequent first. */
  tokens: () => Promise<string[]>;
  /** The native core: fetch + decrypt + write to `targetPath`. */
  nativeDownloadFile: (req: NativeDownloadRequest) => Promise<NativeDownloadResult>;
  clientEnv: () => NativeClientEnv;
  now: () => number;
  pause: (ms: number) => Promise<void>;
  /** Downloads/Yobi; created only when something will be fetched. */
  dir: string;
  /** Notes the saved files for the Downloads/Yobi cleanup. */
  record: (files: string[]) => Promise<void>;
  /** The program the firewall has to allow: Yobi's own executable. */
  exePath: string;
}

/** What to do when Windows blocked the connection: a firewall rule for Yobi's program, not a LINE problem. */
export function firewallHint(exePath: string): string {
  return `Windows blocked the connection before it was made: a firewall or security program (such as Bitdefender or Windows Defender Firewall) does not allow ${exePath} (the program Yobi runs as) to connect. Allow that program in the firewall (rules follow the program's path), then retry; this is not a LINE sign-in problem`;
}

/**
 * The downloads of one run. The first fetch tries the token candidates (inside the core) until the
 * server accepts one, which is then moved to the front and reused; when every candidate is
 * rejected or Windows blocks the connection, later jobs are skipped instead of retried. Calls are
 * spaced by OBS_PAUSE_MS.
 */
class RunState {
  rejected = '';
  /** Set once the server has accepted a token in this run. */
  accepted = false;
  calls = 0;
  constructor(
    readonly deps: DownloadDeps,
    readonly env: NativeClientEnv,
    public tokens: string[],
  ) {}
}

let tempCounter = 0;

// Reads the first bytes of the decrypted file, enough for the extension sniff.
async function readHead(path: string): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function fetchJob(state: RunState, job: DownloadJob, dir: string, saved: string[]): Promise<DownloadResult> {
  if (state.rejected) return { ...job.res, status: 'http_error', note: `skipped: ${state.rejected}` };
  const { deps } = state;
  const candidates = state.tokens.slice(0, MAX_TOKEN_TRIES);
  if (candidates.length === 0) {
    state.rejected = 'no access token candidates (tried 0 token candidates)';
    return { ...job.res, status: 'http_error', note: state.rejected };
  }
  if (state.calls > 0) await deps.pause(OBS_PAUSE_MS);
  state.calls++;
  // The final name depends on the file's first bytes, so the core writes a hidden temp file that is renamed below.
  const targetPath = join(dir, `.yobi-dl-${process.pid}-${tempCounter++}.part`);
  const dropTemp = (): Promise<void> => rm(targetPath, { force: true }).catch(() => undefined);
  let res: NativeDownloadResult;
  try {
    res = await deps.nativeDownloadFile({
      sid: job.sid,
      oid: job.oid,
      messageId: job.res.id,
      keyMaterialB64: job.keyMaterial,
      tokens: candidates,
      clientEnv: state.env,
      targetPath,
      maxBytes: MAX_BODY_BYTES,
    });
  } catch (err) {
    await dropTemp();
    // A missing or broken core fails every row the same way: skip the rest instead of retrying it.
    if (err instanceof LineError && (err.code === 'NATIVE_CORE_UNAVAILABLE' || err.code === 'UNSUPPORTED_PLATFORM')) {
      state.rejected = errorText(err);
      return { ...job.res, status: 'http_error', note: state.rejected };
    }
    return { ...job.res, status: 'http_error', note: `network error: ${errorText(err)}` };
  }
  // Reuse the accepted token first for the next jobs (any outcome after the server accepted it).
  const idx = res.acceptedTokenIndex;
  if (idx >= 0 && idx < candidates.length) {
    state.accepted = true;
    // Once accepted, later jobs carry only that token (the server already vouched for it).
    state.tokens = [candidates[idx]];
  }
  switch (res.status) {
    case 'downloaded':
      break;
    case 'blocked':
      await dropTemp();
      state.rejected = `${NET_BLOCKED}${firewallHint(deps.exePath)}`; // every later request would be blocked too
      return { ...job.res, status: 'http_error', note: state.rejected };
    case 'auth': {
      await dropTemp();
      // Only "no candidate accepted yet" poisons the run; a late 401/403 on one object is that job's alone.
      if (state.accepted) return { ...job.res, status: 'http_error', note: res.reason };
      state.rejected = `${res.reason || 'no access token candidates'} (tried ${candidates.length} token candidates)`;
      return { ...job.res, status: 'http_error', note: state.rejected };
    }
    case 'decrypt_failed':
      await dropTemp();
      return { ...job.res, status: 'decrypt_failed', note: res.reason };
    case 'http_error':
    case 'no_body':
    default:
      await dropTemp();
      return { ...job.res, status: 'http_error', note: res.reason || `unexpected native status: ${String(res.status)}` };
  }
  try {
    const name = downloadFileName(job.res.sent_at ?? '', job.res.id, job.res.filename ?? '', await readHead(targetPath));
    const finalPath = await placeDownload(targetPath, join(dirname(targetPath), name));
    saved.push(finalPath);
    return { ...job.res, status: 'downloaded', saved_as: finalPath, bytes: res.bytes };
  } catch (err) {
    await dropTemp();
    return { ...job.res, status: 'write_failed', note: `write failed: ${errorText(err)}` };
  }
}

/**
 * Downloads a chat's files (with media also images, videos and voice messages), or the one message
 * `id` names, oldest first. The token scan and the folder happen only when something will be fetched.
 */
export async function runDownload(src: MediaSource, q: DownloadQuery, deps: DownloadDeps): Promise<DownloadResult[]> {
  const jobs = downloadJobs(src, q, deps.now());
  if (!jobs.some((job) => job.sid)) return jobs.map((job) => omitEmpty(job.res));
  const tokens = await deps.tokens();
  const dir = await ensureOutputDir(deps.dir);
  const state = new RunState(deps, deps.clientEnv(), tokens);
  const out: DownloadResult[] = [];
  const saved: string[] = [];
  for (const job of jobs) {
    out.push(omitEmpty(job.sid ? await fetchJob(state, job, dir, saved) : job.res));
  }
  if (saved.length > 0) await deps.record(saved).catch(() => undefined);
  return out;
}
