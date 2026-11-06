import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { errorText } from '../../shared/errorText';
import type { YtdlInstallProgress } from '../../shared/ytdl';
import { writeFileAtomic } from '../atomicWrite';
import { sendLog } from '../helpers';
import { VERSION_FILE, ytdlToolsRoot } from './paths';
import type { ToolResult } from './processTree';
import { spawnTool, toolEnv } from './processTree';
import type { ToolFetcher } from './toolFetch';
import { electronToolFetcher } from './toolFetch';
import type { PlatformTools } from './toolManifest';
import {
  FFMPEG_VERSION, YTDLP_SIG_FILE, YTDLP_SUMS_FILE, executableName, ffmpegAssetUrl, platformTools, ytdlpLatestUrl, ytdlpReleaseUrl,
} from './toolManifest';
import { setYtdlProgress } from './toolState';
import { extractZipSafely, gunzipFile, parseSums, sha256File, verifySumsSignature } from './toolVerify';
import { YTDLP_SIGNING_KEY } from './ytdlpSigningKey';

/*
 * The steps of an install: fetch and verify a release, stage each tool in a hidden folder, run it
 * and label it with its version, then swap the staged folder in for the tool's fixed folder. The
 * installer decides what to stage and when the active version changes.
 */

export interface YtdlInstallerDeps {
  fetcher: ToolFetcher;
  run: (cmd: string, args: readonly string[], options: { timeoutMs: number }) => Promise<ToolResult>;
  signingKey: string;
  /** What to download for this machine. */
  tools: () => PlatformTools | null;
  log: (message: string) => void;
}

function defaultDeps(): YtdlInstallerDeps {
  return {
    fetcher: electronToolFetcher,
    run: (cmd, args, options) => spawnTool(cmd, args, { env: toolEnv(), timeoutMs: options.timeoutMs, maxOutputBytes: 64_000 }),
    signingKey: YTDLP_SIGNING_KEY,
    tools: () => platformTools(),
    log: sendLog,
  };
}

let deps: YtdlInstallerDeps = defaultDeps();

/** Swaps the network, process and key dependencies; `null` restores the real ones. */
export function setYtdlInstallerDeps(partial: Partial<YtdlInstallerDeps> | null): void {
  deps = partial ? { ...defaultDeps(), ...partial } : defaultDeps();
}

export function ytdlInstallerDeps(): YtdlInstallerDeps {
  return deps;
}

const SUMS_MAX_BYTES = 256_000;
const SIG_MAX_BYTES = 64_000;
const YTDLP_ZIP_MAX_BYTES = 200_000_000;
/** The first start of a freshly unpacked build can wait on an antivirus scan. */
const SELF_TEST_TIMEOUT_MS = 120_000;
const PROGRESS_INTERVAL_MS = 250;

let lastProgressAt = 0;

function reportProgress(next: YtdlInstallProgress): void {
  const now = Date.now();
  const throttled = next.phase === 'download' && now - lastProgressAt < PROGRESS_INTERVAL_MS && next.receivedBytes < next.totalBytes;
  setYtdlProgress(next, !throttled);
  if (!throttled) lastProgressAt = now;
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 300 ? trimmed.slice(-300) : trimmed;
}

/** Runs `<exe> <flag>`; returns stdout or throws with the end of stderr. */
export async function selfTest(name: string, exe: string, flag: string): Promise<string> {
  let result: ToolResult;
  try {
    result = await deps.run(exe, [flag], { timeoutMs: SELF_TEST_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`${name} did not start: ${errorText(err)}`);
  }
  if (result.code !== 0) {
    const why = result.timedOut ? 'timed out' : `exit ${result.code}: ${tail(result.stderr || result.stdout)}`;
    throw new Error(`${name} self-test failed (${why})`);
  }
  return result.stdout;
}

/** Compares dotted numeric versions (`2026.08.19`, `2026.10.10.233141`). */
export function compareYtdlpVersions(a: string, b: string): number {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export interface YtdlpRelease {
  version: string;
  nightly: boolean;
  sums: Map<string, string>;
}

/** The version the `latest` redirect led to, from `/releases/download/<version>/SHA2-256SUMS`. */
export function versionFromRedirects(urls: readonly string[]): string | null {
  for (const url of urls) {
    const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/([0-9A-Za-z._-]{1,64})\/SHA2-256SUMS$/.exec(url);
    if (match) return match[1];
  }
  return null;
}

export async function fetchRelease(nightly: boolean): Promise<YtdlpRelease> {
  const { body: sums, urls } = await deps.fetcher.fetchBytes(ytdlpLatestUrl(nightly, YTDLP_SUMS_FILE), SUMS_MAX_BYTES);
  const version = versionFromRedirects(urls);
  if (!version) throw new Error('could not tell the latest yt-dlp version from the release redirect');
  const { body: signature } = await deps.fetcher.fetchBytes(ytdlpReleaseUrl(nightly, version, YTDLP_SIG_FILE), SIG_MAX_BYTES);
  try {
    await verifySumsSignature(sums, signature, deps.signingKey);
  } catch (err) {
    throw new Error(`yt-dlp ${version} checksums failed signature verification: ${errorText(err)}`);
  }
  return { version, nightly, sums: parseSums(sums.toString('utf8')) };
}

async function makeExecutable(file: string): Promise<void> {
  if (process.platform !== 'win32') await fs.chmod(file, 0o755);
}

/** Labels a staged folder with the version it holds; the fixed path no longer says. */
async function writeVersionFile(dir: string, version: string): Promise<void> {
  await writeFileAtomic(path.join(dir, VERSION_FILE), `${version}\n`);
}

interface StagedYtdlp {
  dir: string;
  exe: string;
}

export async function stageYtdlp(staging: string, tools: PlatformTools, release: YtdlpRelease): Promise<StagedYtdlp> {
  const asset = tools.ytdlp;
  const expected = release.sums.get(asset.zip);
  if (!expected) throw new Error(`yt-dlp ${release.version} has no checksum for ${asset.zip}`);
  const zipPath = path.join(staging, asset.zip);
  await deps.fetcher.fetchToFile(ytdlpReleaseUrl(release.nightly, release.version, asset.zip), zipPath, {
    maxBytes: YTDLP_ZIP_MAX_BYTES,
    onProgress: (received, total) => reportProgress({ component: 'yt-dlp', phase: 'download', receivedBytes: received, totalBytes: total || asset.approxBytes }),
  });
  reportProgress({ component: 'yt-dlp', phase: 'verify', receivedBytes: 0, totalBytes: 0 });
  if (await sha256File(zipPath) !== expected) throw new Error(`${asset.zip} does not match its signed checksum`);
  reportProgress({ component: 'yt-dlp', phase: 'extract', receivedBytes: 0, totalBytes: 0 });
  const dir = path.join(staging, 'yt-dlp');
  await fs.mkdir(dir, { recursive: true });
  extractZipSafely(zipPath, dir);
  await fs.rm(zipPath, { force: true });
  const exe = path.join(dir, asset.exe);
  await fs.access(exe).catch(() => {
    throw new Error(`${asset.zip} has no ${asset.exe}`);
  });
  await makeExecutable(exe);
  reportProgress({ component: 'yt-dlp', phase: 'test', receivedBytes: 0, totalBytes: 0 });
  await selfTest('yt-dlp', exe, '--version');
  await writeVersionFile(dir, release.version);
  return { dir, exe: asset.exe };
}

export async function stageFfmpeg(dir: string, tools: PlatformTools): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const component of ['ffmpeg', 'ffprobe'] as const) {
    const asset = tools[component];
    const gz = path.join(dir, asset.name);
    await deps.fetcher.fetchToFile(ffmpegAssetUrl(asset), gz, {
      maxBytes: asset.bytes,
      onProgress: (received) => reportProgress({ component, phase: 'download', receivedBytes: received, totalBytes: asset.bytes }),
    });
    reportProgress({ component, phase: 'verify', receivedBytes: 0, totalBytes: 0 });
    if (await sha256File(gz) !== asset.sha256) throw new Error(`${asset.name} does not match its pinned checksum`);
    reportProgress({ component, phase: 'extract', receivedBytes: 0, totalBytes: 0 });
    const exe = path.join(dir, executableName(component));
    await gunzipFile(gz, exe);
    await fs.rm(gz, { force: true });
    await makeExecutable(exe);
    reportProgress({ component, phase: 'test', receivedBytes: 0, totalBytes: 0 });
    await selfTest(component, exe, '-version');
  }
  await writeVersionFile(dir, FFMPEG_VERSION);
}

const RENAME_LOCKED_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 3_000, 4_000, 5_000];

/**
 * `fs.rename`, waiting out Windows' hold on a folder whose program just ran: the exe stays locked
 * for a moment (antivirus scanning it, the image still mapped), and renaming the folder then fails
 * with EPERM.
 */
export async function renameWhenUnlocked(
  from: string,
  to: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!RENAME_LOCKED_CODES.has(code) || delay === undefined) throw err;
      await sleep(delay);
    }
  }
}

const STAGING_PREFIX = '.staging-';
const REPLACED_PREFIX = '.old-';

/**
 * Puts a staged folder at `<tools root>/<name>`, replacing what is there, so the program's path is
 * the same for every version. Call it only inside `withToolsIdle`. The old folder is moved aside
 * (deleted by `pruneLeftovers`) and put back when the staged one cannot move in. An install from
 * before the fixed folders kept its versions inside `<name>/`; they go aside with it.
 */
export async function replaceFolder(staged: string, name: string): Promise<string> {
  const target = path.join(ytdlToolsRoot(), name);
  const aside = await moveAside(target);
  try {
    await renameWhenUnlocked(staged, target);
  } catch (err) {
    if (aside) {
      await renameWhenUnlocked(aside, target).catch((restoreErr) => deps.log(`[Ytdl] could not put ${name} back: ${errorText(restoreErr)}`));
    }
    throw err;
  }
  return target;
}

/** Renames `dir` to a `.old-*` folder for `pruneLeftovers`; null when there is no `dir`. */
async function moveAside(dir: string): Promise<string | null> {
  const aside = path.join(ytdlToolsRoot(), `${REPLACED_PREFIX}${randomBytes(3).toString('hex')}`);
  try {
    await renameWhenUnlocked(dir, aside);
    return aside;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Turns `<name>/` from before the fixed folders, which held one folder per version, into the fixed
 * folder without downloading again: `keep` (the version in use, inside it) becomes `<name>/`
 * itself, labelled with its version, and the other versions go aside; with no `keep`, all of it
 * goes. Call it only inside `withToolsIdle`.
 */
export async function adoptLegacyFolder(name: string, keep: { dir: string; version: string } | null): Promise<void> {
  if (!keep) {
    await moveAside(path.join(ytdlToolsRoot(), name));
    return;
  }
  const moving = path.join(ytdlToolsRoot(), `${STAGING_PREFIX}${randomBytes(3).toString('hex')}`);
  await renameWhenUnlocked(keep.dir, moving);
  try {
    await writeVersionFile(moving, keep.version);
    await replaceFolder(moving, name);
  } catch (err) {
    await renameWhenUnlocked(moving, keep.dir).catch((restoreErr) => deps.log(`[Ytdl] could not put ${keep.dir} back: ${errorText(restoreErr)}`));
    throw err;
  }
}

/** Deletes what installs leave behind: staging folders and the folders `replaceFolder` moved aside. */
export async function pruneLeftovers(): Promise<void> {
  const root = ytdlToolsRoot();
  const entries = await fs.readdir(root).catch(() => [] as string[]);
  for (const name of entries.filter((n) => n.startsWith(STAGING_PREFIX) || n.startsWith(REPLACED_PREFIX))) {
    // A folder an antivirus scan still holds is locked on Windows; the next prune gets it.
    await fs.rm(path.join(root, name), { recursive: true, force: true }).catch((err) => deps.log(`[Ytdl] could not remove ${name}: ${errorText(err)}`));
  }
}

export async function withStaging<T>(fn: (staging: string) => Promise<T>): Promise<T> {
  const root = ytdlToolsRoot();
  await fs.mkdir(root, { recursive: true });
  const staging = await fs.mkdtemp(path.join(root, STAGING_PREFIX));
  try {
    return await fn(staging);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
