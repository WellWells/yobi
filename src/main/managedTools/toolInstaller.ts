import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MANAGED_TOOL_ROWS } from '../../shared/managedTools';
import type { ManagedToolId, ManagedToolProgress, ManagedToolState } from '../../shared/managedTools';
import { errorText } from '../../shared/errorText';
import { Mutex } from '../flow/lanes';
import type { GithubRelease } from './githubRelease';
import { fetchReleases, pickRelease, releaseAssetUrl } from './githubRelease';
import { compareVersions } from './paths';
import { renameWhenUnlocked } from './rename';
import type { ManagedToolSpec } from './specs';
import { toolSpec } from './specs';
import type { ToolFetcher } from './toolFetch';
import { electronToolFetcher } from './toolFetch';
import { forgetLookup, resolveTool, testCopy, toolRunner } from './toolResolve';
import { managedExecutable, readToolState, setInstalling, setProgress, snapshot, toolRoot, updateToolState } from './toolStore';
import { parseSums, sha256File } from './toolVerify';

/*
 * Installs and updates Yobi's own copy: pick a release → download into a hidden staging folder →
 * check it against the release's SHA256SUMS and GitHub's own digest → run it → swap it in for the
 * fixed path. Anything failing before the swap leaves the previous copy exactly as it was. Only
 * Yobi's copy is ever replaced: one the user installed or chose updates itself or not at all.
 */

const SUMS_MAX_BYTES = 256_000;
const UPDATE_CHECK_MIN_GAP_MS = 60 * 60_000;
const PROGRESS_INTERVAL_MS = 250;
const STAGING_PREFIX = '.staging-';
const REPLACED_PREFIX = '.old-';

let fetcher: ToolFetcher = electronToolFetcher;

/** Swaps the network for tests; `null` restores the real one. */
export function setToolFetcher(next: ToolFetcher | null): void {
  fetcher = next ?? electronToolFetcher;
}

const locks = new Map<ManagedToolId, Mutex>();
function lockOf(id: ManagedToolId): Mutex {
  let lock = locks.get(id);
  if (!lock) {
    lock = new Mutex();
    locks.set(id, lock);
  }
  return lock;
}

let lastProgressAt = 0;
function report(id: ManagedToolId, next: ManagedToolProgress): void {
  const now = Date.now();
  const throttled = next.phase === 'download' && now - lastProgressAt < PROGRESS_INTERVAL_MS && next.receivedBytes < next.totalBytes;
  setProgress(id, next, !throttled);
  if (!throttled) lastProgressAt = now;
}

function assetFor(spec: ManagedToolSpec): { name: string; approxBytes: number } {
  const asset = spec.asset(process.platform, process.arch);
  if (!asset) throw new Error(`${spec.name} has no build for ${process.platform}-${process.arch}`);
  return asset;
}

async function chooseRelease(spec: ManagedToolSpec): Promise<GithubRelease> {
  const asset = assetFor(spec);
  const release = pickRelease(await fetchReleases(fetcher, spec.repo), [asset.name, spec.sumsFile], spec.releaseAgeMs);
  if (!release) throw new Error(`${spec.name} has no release with ${asset.name} that is old enough yet`);
  return release;
}

/** Downloads, verifies and runs the release's file in `staging`; the staged executable and its version. */
async function stage(spec: ManagedToolSpec, release: GithubRelease, staging: string): Promise<{ exe: string; version: string }> {
  const asset = assetFor(spec);
  const listed = release.assets.find((a) => a.name === asset.name);
  const { body } = await fetcher.fetchBytes(releaseAssetUrl(spec.repo, release.tag, spec.sumsFile), SUMS_MAX_BYTES);
  const expected = parseSums(body.toString('utf8')).get(asset.name);
  if (!expected) throw new Error(`${spec.name} ${release.version} lists no checksum for ${asset.name}`);
  if (listed?.sha256 && listed.sha256 !== expected) throw new Error(`${asset.name}: SHA256SUMS and GitHub disagree on its checksum`);
  const exe = path.join(staging, path.basename(managedExecutable(spec.id)));
  // Twice the listed size covers an honest re-upload; anything larger is not this file.
  const maxBytes = Math.max(listed?.size ?? asset.approxBytes, asset.approxBytes) * 2;
  await fetcher.fetchToFile(releaseAssetUrl(spec.repo, release.tag, asset.name), exe, {
    maxBytes,
    onProgress: (received, total) => report(spec.id, { phase: 'download', receivedBytes: received, totalBytes: total || listed?.size || asset.approxBytes }),
  });
  report(spec.id, { phase: 'verify', receivedBytes: 0, totalBytes: 0 });
  if (await sha256File(exe) !== expected) throw new Error(`${asset.name} does not match its checksum`);
  if (process.platform !== 'win32') await fs.chmod(exe, 0o755);
  report(spec.id, { phase: 'test', receivedBytes: 0, totalBytes: 0 });
  const version = await testCopy(spec, exe, 'managed');
  return { exe, version };
}

/**
 * Puts the staged executable at the fixed path. The running one is renamed aside first (Windows
 * lets a running program's file be renamed, not deleted), and put back if the new one cannot move in.
 */
async function swapIn(id: ManagedToolId, staged: string): Promise<void> {
  const target = managedExecutable(id);
  const aside = path.join(toolRoot(id), `${REPLACED_PREFIX}${randomBytes(3).toString('hex')}-${path.basename(target)}`);
  let moved = false;
  try {
    await renameWhenUnlocked(target, aside);
    moved = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  try {
    await renameWhenUnlocked(staged, target);
  } catch (err) {
    if (moved) await renameWhenUnlocked(aside, target).catch((restoreErr) => toolRunner().log(`[Tools] could not put ${path.basename(target)} back: ${errorText(restoreErr)}`));
    throw err;
  }
}

/** Deletes staging folders and the copies `swapIn` moved aside; one still running waits for the next prune. */
export async function pruneLeftovers(id: ManagedToolId): Promise<void> {
  const root = toolRoot(id);
  const names = await fs.readdir(root).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.startsWith(STAGING_PREFIX) || n.startsWith(REPLACED_PREFIX))) {
    await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function installRelease(spec: ManagedToolSpec, release: GithubRelease): Promise<string> {
  await fs.mkdir(toolRoot(spec.id), { recursive: true });
  const staging = await fs.mkdtemp(path.join(toolRoot(spec.id), STAGING_PREFIX));
  try {
    const staged = await stage(spec, release, staging);
    await swapIn(spec.id, staged.exe);
    return staged.version;
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runInstall(id: ManagedToolId): Promise<ManagedToolState> {
  const spec = toolSpec(id);
  setInstalling(id, true);
  try {
    const version = await installRelease(spec, await chooseRelease(spec));
    await updateToolState(id, (s) => {
      s.managedVersion = version;
      s.lastCheckedAt = new Date().toISOString();
      s.installError = undefined;
    });
    toolRunner().log(`[Tools] installed ${spec.name} ${version}`);
  } catch (err) {
    toolRunner().log(`[Tools] installing ${spec.name} failed: ${errorText(err)}`);
    await updateToolState(id, (s) => {
      s.installError = errorText(err);
    }).catch(() => undefined);
  } finally {
    await pruneLeftovers(id);
    setInstalling(id, false);
    forgetLookup(id);
  }
  await resolveTool(id, { fresh: true });
  return snapshot(id);
}

const installRuns = new Map<ManagedToolId, Promise<ManagedToolState>>();

/** Downloads Yobi's own copy; concurrent callers share one run. A failure is in `installError`. */
export function installManagedTool(id: ManagedToolId): Promise<ManagedToolState> {
  let run = installRuns.get(id);
  if (!run) {
    run = lockOf(id).runExclusive(() => runInstall(id)).finally(() => installRuns.delete(id));
    installRuns.set(id, run);
  }
  return run;
}

export interface ToolUpdateResult {
  updated: boolean;
  version?: string;
}

async function runUpdate(id: ManagedToolId, force: boolean): Promise<ToolUpdateResult> {
  const spec = toolSpec(id);
  const state = readToolState(id);
  if (!state.managedVersion || !spec.asset(process.platform, process.arch)) return { updated: false };
  const last = Date.parse(state.lastCheckedAt ?? '');
  if (!force && Number.isFinite(last) && Date.now() - last < UPDATE_CHECK_MIN_GAP_MS) return { updated: false, version: state.managedVersion };
  const checkedAt = new Date().toISOString();
  try {
    const release = await chooseRelease(spec);
    if (compareVersions(release.version, state.managedVersion) <= 0) {
      await updateToolState(id, (s) => {
        s.lastCheckedAt = checkedAt;
        s.installError = undefined;
      });
      return { updated: false, version: state.managedVersion };
    }
    const version = await installRelease(spec, release);
    await updateToolState(id, (s) => {
      s.managedVersion = version;
      s.lastCheckedAt = checkedAt;
      s.installError = undefined;
    });
    toolRunner().log(`[Tools] updated ${spec.name} ${state.managedVersion} → ${version}`);
    forgetLookup(id);
    // Look again now, so the state a background update broadcasts names the copy in use.
    await resolveTool(id, { fresh: true }).catch(() => undefined);
    return { updated: true, version };
  } catch (err) {
    toolRunner().log(`[Tools] ${spec.name} update check failed: ${errorText(err)}`);
    await updateToolState(id, (s) => {
      s.lastCheckedAt = checkedAt;
      s.installError = errorText(err);
    }).catch(() => undefined);
    return { updated: false, version: state.managedVersion };
  } finally {
    await pruneLeftovers(id);
    setProgress(id, undefined);
  }
}

/** Yobi's own copy only: installs a newer release once it is old enough. Without `force`, at most hourly. */
export function checkManagedToolUpdate(id: ManagedToolId, options: { force?: boolean } = {}): Promise<ToolUpdateResult> {
  return lockOf(id).runExclusive(() => runUpdate(id, options.force === true));
}

/** Deletes Yobi's own copy and its record; a copy elsewhere on the computer is left alone. */
export function removeManagedTool(id: ManagedToolId): Promise<ManagedToolState> {
  return lockOf(id).runExclusive(async () => {
    const exe = managedExecutable(id);
    // A running copy cannot be deleted on Windows; renamed aside, the next prune gets it.
    const aside = path.join(toolRoot(id), `${REPLACED_PREFIX}${randomBytes(3).toString('hex')}-${path.basename(exe)}`);
    await renameWhenUnlocked(exe, aside).catch(() => undefined);
    await pruneLeftovers(id);
    await updateToolState(id, (s) => {
      s.managedVersion = undefined;
      s.lastCheckedAt = undefined;
      s.installError = undefined;
    });
    forgetLookup(id);
    await resolveTool(id, { fresh: true });
    return snapshot(id);
  });
}

/**
 * Uses a copy at `file` instead (`null` goes back to looking one up). The copy must start and be
 * new enough before anything is saved; Yobi never updates it.
 */
export function setManagedToolCustomPath(id: ManagedToolId, file: string | null): Promise<ManagedToolState> {
  return lockOf(id).runExclusive(async () => {
    const spec = toolSpec(id);
    if (file === null) {
      await updateToolState(id, (s) => {
        s.customPath = undefined;
        s.installError = undefined;
      });
    } else {
      const chosen = path.normalize(file);
      try {
        if (!path.isAbsolute(chosen)) throw new Error('the path must be absolute');
        await testCopy(spec, chosen, 'custom');
        await updateToolState(id, (s) => {
          s.customPath = chosen;
          s.installError = undefined;
        });
      } catch (err) {
        await updateToolState(id, (s) => {
          s.installError = errorText(err);
        });
      }
    }
    forgetLookup(id);
    await resolveTool(id, { fresh: true });
    return snapshot(id);
  });
}

const FIRST_CHECK_DELAY_MS = 5 * 60_000;
const TICK_MS = 60 * 60_000;
const DAILY_MS = 24 * 60 * 60_000;
let timer: NodeJS.Timeout | null = null;

/** Every tool Yobi downloaded is checked once a day. */
export async function scheduledToolChecks(now = Date.now()): Promise<void> {
  for (const { id } of MANAGED_TOOL_ROWS) {
    const state = readToolState(id);
    if (!state.managedVersion) continue;
    const last = Date.parse(state.lastCheckedAt ?? '');
    if (Number.isFinite(last) && now - last < DAILY_MS) continue;
    await checkManagedToolUpdate(id, { force: true });
  }
}

function schedule(delay: number): void {
  timer = setTimeout(() => {
    schedule(TICK_MS);
    scheduledToolChecks().catch(() => undefined);
  }, delay);
  timer.unref();
}

export function startManagedToolUpdates(): void {
  if (timer) return;
  for (const { id } of MANAGED_TOOL_ROWS) void pruneLeftovers(id);
  schedule(FIRST_CHECK_DELAY_MS);
}

export function stopManagedToolUpdates(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
