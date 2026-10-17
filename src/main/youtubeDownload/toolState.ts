import { existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { normalizeSiteChanged } from '../../shared/linkSites/siteChanged';
import type { SiteChangedMap } from '../../shared/linkSites/siteChanged';
import { rowById } from '../../shared/linkSites/rows';
import type { LinkSiteId } from '../../shared/linkSites/types';
import type { YtdlFailureCategory, YtdlInstallProgress, YtdlLastFailure, YtdlToolStatus, YtdlToolsState } from '../../shared/ytdl';
import { writeFileAtomic } from '../atomicWrite';
import { Mutex } from '../flow/lanes';
import { isInsideDir, ytdlToolsRoot } from './paths';
import { executableName, platformTools, toolsDownloadBytes } from './toolManifest';

/*
 * The one record of the download tools: `<userData>/tools/ytdl/state.json` plus what only lives in
 * memory (an install in progress and its progress). Read lazily on first use, never at import.
 */

export interface InstalledYtdlp {
  version: string;
  nightly: boolean;
  /** Relative to the tools root. */
  dir: string;
  exe: string;
}

export interface InstalledFfmpeg {
  version: string;
  /** Relative to the tools root; holds ffmpeg and ffprobe. */
  dir: string;
}

export interface YtdlCustomPaths {
  ytdlp: string;
  ffmpegDir: string;
}

export interface PersistedYtdlState {
  ytdlp?: InstalledYtdlp;
  /** Kept for rollback; deleted when the next version replaces it. */
  previousYtdlp?: InstalledYtdlp;
  ffmpeg?: InstalledFfmpeg;
  /** The last self-test of the managed tools passed. */
  testedOk?: boolean;
  nightly?: boolean;
  customPaths?: YtdlCustomPaths;
  customVersion?: string;
  /** YouTube changed and no newer yt-dlp is installed yet: YouTube downloads are paused. */
  youtubeChangedAt?: string;
  /** The same per other site (`linkSites/siteChanged.ts`); YouTube's stays in `youtubeChangedAt`. */
  siteChangedAt?: SiteChangedMap;
  lastFailure?: YtdlLastFailure;
  lastCheckedAt?: string;
  installError?: string;
}

export interface YtdlToolPaths {
  ytdlp: string;
  ffmpegDir: string;
  ffmpeg: string;
  ffprobe: string;
  managed: boolean;
}

let persisted: PersistedYtdlState = {};
let loaded = false;
let filesPresent = false;
let installing = false;
let progress: YtdlInstallProgress | undefined;
const listeners = new Set<(state: YtdlToolsState) => void>();
const writeLock = new Mutex();

function statePath(): string {
  return path.join(ytdlToolsRoot(), 'state.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readYtdlp(value: unknown): InstalledYtdlp | undefined {
  if (!isRecord(value)) return undefined;
  const version = str(value.version);
  const dir = str(value.dir);
  const exe = str(value.exe);
  if (!version || !dir || !exe) return undefined;
  return { version, nightly: value.nightly === true, dir, exe };
}

/** A hand-edited or half-understood file keeps whatever still has the right shape. */
export function normalizeYtdlState(raw: unknown): PersistedYtdlState {
  if (!isRecord(raw)) return {};
  const state: PersistedYtdlState = {};
  state.ytdlp = readYtdlp(raw.ytdlp);
  state.previousYtdlp = readYtdlp(raw.previousYtdlp);
  if (isRecord(raw.ffmpeg) && str(raw.ffmpeg.version) && str(raw.ffmpeg.dir)) {
    state.ffmpeg = { version: String(raw.ffmpeg.version), dir: String(raw.ffmpeg.dir) };
  }
  state.testedOk = raw.testedOk === true;
  state.nightly = raw.nightly === true;
  if (isRecord(raw.customPaths) && str(raw.customPaths.ytdlp) && str(raw.customPaths.ffmpegDir)) {
    state.customPaths = { ytdlp: String(raw.customPaths.ytdlp), ffmpegDir: String(raw.customPaths.ffmpegDir) };
  }
  state.customVersion = str(raw.customVersion);
  state.youtubeChangedAt = str(raw.youtubeChangedAt);
  state.siteChangedAt = normalizeSiteChanged(raw.siteChangedAt);
  if (isRecord(raw.lastFailure) && str(raw.lastFailure.category) && str(raw.lastFailure.at)) {
    const site = str(raw.lastFailure.site);
    state.lastFailure = {
      category: raw.lastFailure.category as YtdlFailureCategory,
      at: String(raw.lastFailure.at),
      // A site the table does not know is dropped, so the record reads as YouTube's.
      ...(site && rowById(site) ? { site: site as LinkSiteId } : {}),
    };
  }
  state.lastCheckedAt = str(raw.lastCheckedAt);
  state.installError = str(raw.installError);
  return state;
}

/** An absolute path inside the tools root, or null for a record pointing anywhere else. */
export function toolsPath(relative: string): string | null {
  const root = ytdlToolsRoot();
  const full = path.resolve(root, relative);
  return isInsideDir(root, full) && full !== path.resolve(root) ? full : null;
}

export function managedToolPaths(state: PersistedYtdlState = persisted): YtdlToolPaths | null {
  if (!state.ytdlp || !state.ffmpeg) return null;
  const ytdlpDir = toolsPath(state.ytdlp.dir);
  const ffmpegDir = toolsPath(state.ffmpeg.dir);
  if (!ytdlpDir || !ffmpegDir) return null;
  const ytdlp = path.join(ytdlpDir, state.ytdlp.exe);
  if (!isInsideDir(ytdlpDir, ytdlp)) return null;
  return {
    ytdlp,
    ffmpegDir,
    ffmpeg: path.join(ffmpegDir, executableName('ffmpeg')),
    ffprobe: path.join(ffmpegDir, executableName('ffprobe')),
    managed: true,
  };
}

export function customToolPaths(custom: YtdlCustomPaths): YtdlToolPaths {
  return {
    ytdlp: custom.ytdlp,
    ffmpegDir: custom.ffmpegDir,
    ffmpeg: path.join(custom.ffmpegDir, executableName('ffmpeg')),
    ffprobe: path.join(custom.ffmpegDir, executableName('ffprobe')),
    managed: false,
  };
}

function managedFilesPresent(state: PersistedYtdlState): boolean {
  const paths = managedToolPaths(state);
  if (!paths) return false;
  return [paths.ytdlp, paths.ffmpeg, paths.ffprobe].every((file) => existsSync(file));
}

/**
 * Reads state.json on first use. Synchronous on purpose: the file is a few hundred bytes plus three
 * existence checks, and readiness checks in flows and menus need an answer without awaiting.
 */
function ensureLoaded(): void {
  if (loaded) return;
  try {
    persisted = normalizeYtdlState(JSON.parse(readFileSync(statePath(), 'utf-8')));
  } catch {
    persisted = {};
  }
  filesPresent = managedFilesPresent(persisted);
  loaded = true;
}

/** Forgets the in-memory copy, so the next use reads `state.json` again (after a factory reset). */
export function reloadYtdlState(): void {
  loaded = false;
  persisted = {};
  filesPresent = false;
  installing = false;
  progress = undefined;
}

function currentStatus(): YtdlToolStatus {
  if (installing) return 'installing';
  if (persisted.customPaths) return 'custom';
  if (!persisted.ytdlp || !persisted.ffmpeg || !filesPresent) return 'missing';
  return persisted.testedOk ? 'ready' : 'broken';
}

function snapshot(): YtdlToolsState {
  const tools = platformTools();
  const custom = persisted.customPaths;
  return {
    status: currentStatus(),
    supported: tools !== null,
    progress,
    ytdlpVersion: custom ? persisted.customVersion : persisted.ytdlp?.version,
    ffmpegVersion: custom ? undefined : persisted.ffmpeg?.version,
    downloadBytes: toolsDownloadBytes(tools),
    location: ytdlToolsRoot(),
    nightly: persisted.nightly === true,
    customPaths: custom ? { ...custom } : undefined,
    youtubeChangedAt: persisted.youtubeChangedAt,
    siteChangedAt: persisted.siteChangedAt ? { ...persisted.siteChangedAt } : undefined,
    lastFailure: persisted.lastFailure ? { ...persisted.lastFailure } : undefined,
    installError: persisted.installError,
    lastCheckedAt: persisted.lastCheckedAt,
  };
}

function broadcast(): void {
  const state = snapshot();
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // One broken listener must not stop the others.
    }
  }
}

export function getYtdlToolsState(): YtdlToolsState {
  ensureLoaded();
  return snapshot();
}

export function onYtdlToolsState(listener: (state: YtdlToolsState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A copy of the persisted record, for decisions; change it only through `updateYtdlState`. */
export async function readYtdlState(): Promise<PersistedYtdlState> {
  ensureLoaded();
  return structuredClone(persisted);
}

/** Writes are serialized; a failed write leaves the in-memory state as it was. */
export async function updateYtdlState(mutate: (state: PersistedYtdlState) => void): Promise<YtdlToolsState> {
  ensureLoaded();
  return writeLock.runExclusive(async () => {
    const next = structuredClone(persisted);
    mutate(next);
    await fs.mkdir(ytdlToolsRoot(), { recursive: true });
    await writeFileAtomic(statePath(), JSON.stringify(next, null, 2));
    persisted = next;
    filesPresent = managedFilesPresent(next);
    broadcast();
    return snapshot();
  });
}

export function setYtdlInstalling(on: boolean): void {
  installing = on;
  if (!on) progress = undefined;
  broadcast();
}

export function setYtdlProgress(next: YtdlInstallProgress | undefined, notify = true): void {
  progress = next;
  if (notify) broadcast();
}

export async function resolveYtdlTools(): Promise<YtdlToolPaths | null> {
  ensureLoaded();
  if (persisted.customPaths) return customToolPaths(persisted.customPaths);
  const status = currentStatus();
  if (status !== 'ready' && !(status === 'installing' && persisted.testedOk && filesPresent)) return null;
  return managedToolPaths();
}
