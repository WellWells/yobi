import * as path from 'node:path';
import type { TriggerConfig } from '../../shared/types';
import {
  FILE_TRIGGER_NAME_VAR,
  FILE_TRIGGER_PATH_VAR,
  PARTIAL_SIBLING_SUFFIXES,
  isTemporaryFileName,
  isTemporaryFolderName,
  isUsableWatchFolder,
  matchesWatchPattern,
  parseWatchPatterns,
} from '../../shared/flowFileTrigger';
import { sendLog } from '../helpers';
import { expandHome } from '../homePath';
import { PRODUCED_FILES_KEY } from './interpolation';
import { nodeFileWatchFs } from './folderWatchFs';
import type { FileWatchFs, FolderWatchHandle, WatchedFileStat } from './folderWatchFs';

export { nodeFileWatchFs };
export type { FileWatchFs, FolderWatchHandle, WatchedFileStat };

/** How often a new file is looked at while it may still be being written. */
export const FILE_STABLE_POLL_MS = 1_000;
/** Looks in a row with the same size and time before the file counts as finished. */
export const FILE_STABLE_CHECKS = 2;
/** A file still changing (or still empty) after this is left alone, with a log line. */
export const FILE_STABLE_GIVE_UP_MS = 30 * 60_000;
/** Events arrive in bursts (one save can be five); one folder read answers the whole burst. */
export const FILE_RESCAN_DEBOUNCE_MS = 300;
/** How often a missing folder is looked for again, and a watched one checked that it still exists. */
export const FOLDER_RECHECK_MS = 30_000;
/** The same file appearing again this soon is the same arrival, not a second one. */
export const FILE_REFIRE_WINDOW_MS = 60_000;
/** A file that vanishes and returns this fast was replaced in place (an editor's save), not added. */
export const FILE_VANISH_GRACE_MS = 5_000;
/** Runs one flow may have waiting; files beyond it are logged and skipped. */
export const MAX_PENDING_FILE_RUNS = 20;

/** Starts one run of the flow for the file; resolves when that run has ended. */
export type FileFire = (flowId: string, filePath: string) => Promise<unknown>;

/**
 * What a run started by a new file begins with: {{file}} and {{file.name}}, and the file on the
 * run's own list, so a bot, email or AI step may send it like a file the run made itself — the
 * person chose the folder.
 */
export function fileRunContext(filePath: string): Record<string, string> {
  return {
    [FILE_TRIGGER_PATH_VAR]: filePath,
    [FILE_TRIGGER_NAME_VAR]: path.basename(filePath),
    [PRODUCED_FILES_KEY]: JSON.stringify([filePath]),
  };
}

interface PendingFile {
  last: WatchedFileStat;
  unchanged: number;
  since: number;
  timer: NodeJS.Timeout | null;
}

interface FolderWatch {
  key: string;
  flowId: string;
  flowName: string;
  folder: string;
  patterns: string[];
  recursive: boolean;
  stopped: boolean;
  missing: boolean;
  /** The files present at the start have been read; until then an event only marks a read as due. */
  ready: boolean;
  /** A start is in flight (reading a large tree can outlast a recheck); a second would leak a watcher. */
  starting: boolean;
  watcher: FolderWatchHandle | null;
  known: Set<string>;
  vanished: Map<string, number>;
  pending: Map<string, PendingFile>;
  scanning: boolean;
  scanAgain: boolean;
  rescanTimer: NodeJS.Timeout | null;
  recheckTimer: NodeJS.Timeout | null;
}

interface FlowRunQueue {
  flowName: string;
  files: string[];
  busy: boolean;
  recent: Map<string, number>;
  /** Its flow stopped watching; dropped at the end of the tick unless the flow is re-registered. */
  detached: boolean;
}

/**
 * Watches folders for files that appear (created, or renamed or moved in) after the watch started
 * and hands each finished one to `fire`, one run at a time per flow. Events are only a nudge: every
 * one leads to a read of the folder compared with the files already known, because Windows reports
 * a create as "rename" and macOS merges events, so the event type and name say nothing reliable.
 */
export class FileTriggers {
  private watches = new Map<string, FolderWatch>();
  private queues = new Map<string, FlowRunQueue>();
  private missingKeys = new Set<string>();

  constructor(
    private readonly fire: FileFire,
    private readonly onMissingChange: (flowIds: string[]) => void = () => undefined,
    private readonly fsApi: FileWatchFs = nodeFileWatchFs,
  ) {}

  add(flowId: string, flowName: string, trigger: TriggerConfig, triggerIndex: number): void {
    const raw = (trigger.watchFolder ?? '').trim();
    if (!isUsableWatchFolder(raw)) {
      sendLog(`⚠️ [Flow] "${flowName}" watches no folder — pick one in its trigger`);
      return;
    }
    const watch: FolderWatch = {
      key: `${flowId}#${triggerIndex}`,
      flowId,
      flowName,
      folder: path.resolve(expandHome(raw)),
      patterns: parseWatchPatterns(trigger.watchPattern),
      recursive: trigger.watchSubfolders === true,
      stopped: false,
      missing: false,
      ready: false,
      starting: false,
      watcher: null,
      known: new Set(),
      vanished: new Map(),
      pending: new Map(),
      scanning: false,
      scanAgain: false,
      rescanTimer: null,
      recheckTimer: null,
    };
    this.watches.set(watch.key, watch);
    const queue = this.queues.get(flowId);
    if (queue) {
      queue.detached = false;
      queue.flowName = flowName;
      this.pump(flowId, queue);
    } else {
      this.queues.set(flowId, { flowName, files: [], busy: false, recent: new Map(), detached: false });
    }
    watch.recheckTimer = setInterval(() => void this.recheck(watch), FOLDER_RECHECK_MS);
    watch.recheckTimer.unref?.();
    void this.start(watch);
  }

  remove(flowId: string): void {
    for (const watch of [...this.watches.values()]) {
      if (watch.flowId === flowId) this.stop(watch);
    }
    const queue = this.queues.get(flowId);
    if (!queue) return;
    // A save unregisters and registers again in the same tick: the run in progress and the files
    // waiting behind it carry over to the new watch instead of the next file starting beside it.
    queue.detached = true;
    queueMicrotask(() => {
      if (!queue.detached || this.queues.get(flowId) !== queue) return;
      if (queue.files.length > 0) {
        sendLog(`📂 [Flow] ${queue.files.length} new file(s) were waiting for a flow that stopped watching — not run`);
      }
      this.queues.delete(flowId);
    });
  }

  /** The flow has a folder watch right now: false once it was disabled, deleted or the app shut down. */
  watchesFiles(flowId: string): boolean {
    const queue = this.queues.get(flowId);
    return queue !== undefined && !queue.detached;
  }

  clear(): void {
    for (const flowId of new Set([...this.watches.values()].map((w) => w.flowId))) this.remove(flowId);
  }

  /** Flows with a watched folder that is not there right now. */
  missingFlowIds(): string[] {
    const ids = new Set<string>();
    for (const key of this.missingKeys) {
      const watch = this.watches.get(key);
      if (watch) ids.add(watch.flowId);
    }
    return [...ids];
  }

  private stop(watch: FolderWatch): void {
    watch.stopped = true;
    watch.watcher?.close();
    watch.watcher = null;
    if (watch.rescanTimer) clearTimeout(watch.rescanTimer);
    if (watch.recheckTimer) clearInterval(watch.recheckTimer);
    for (const pending of watch.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    watch.pending.clear();
    this.watches.delete(watch.key);
    this.setMissing(watch, false);
  }

  private setMissing(watch: FolderWatch, missing: boolean): void {
    watch.missing = missing;
    const had = this.missingKeys.has(watch.key);
    if (missing === had) return;
    if (missing) this.missingKeys.add(watch.key);
    else this.missingKeys.delete(watch.key);
    this.onMissingChange(this.missingFlowIds());
  }

  /** The files there now are the starting point: only what appears after this runs the flow. */
  private async start(watch: FolderWatch): Promise<void> {
    if (watch.starting) return;
    watch.starting = true;
    try {
      await this.open(watch);
    } finally {
      watch.starting = false;
    }
  }

  private async open(watch: FolderWatch): Promise<void> {
    const st = await this.fsApi.stat(watch.folder);
    if (watch.stopped) return;
    if (!st?.isDirectory) {
      if (!watch.missing) sendLog(`⚠️ [Flow] "${watch.flowName}" watches "${watch.folder}", which is not there — checking again every ${FOLDER_RECHECK_MS / 1_000} s`);
      this.setMissing(watch, true);
      return;
    }
    try {
      watch.watcher = this.fsApi.watch(
        watch.folder,
        watch.recursive,
        () => this.scheduleRescan(watch),
        (err) => this.onWatchError(watch, err),
      );
      watch.known = await this.fsApi.list(watch.folder, watch.recursive);
    } catch (err) {
      watch.watcher?.close();
      watch.watcher = null;
      sendLog(`⚠️ [Flow] Could not watch "${watch.folder}" for "${watch.flowName}": ${err instanceof Error ? err.message : String(err)}`);
      this.setMissing(watch, true);
      return;
    }
    if (watch.stopped) {
      watch.watcher?.close();
      return;
    }
    watch.ready = true;
    this.setMissing(watch, false);
    if (watch.scanAgain) {
      watch.scanAgain = false;
      this.scheduleRescan(watch);
    }
    sendLog(`📂 [Flow] Watching "${watch.folder}"${watch.recursive ? ' and its subfolders' : ''} for "${watch.flowName}"`);
  }

  private onWatchError(watch: FolderWatch, err: unknown): void {
    if (watch.stopped) return;
    sendLog(`⚠️ [Flow] Stopped watching "${watch.folder}" for "${watch.flowName}": ${err instanceof Error ? err.message : String(err)}`);
    this.lose(watch);
  }

  /** The folder went away (deleted, drive unplugged): wait for it to come back. */
  private lose(watch: FolderWatch): void {
    watch.ready = false;
    watch.watcher?.close();
    watch.watcher = null;
    for (const pending of watch.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    watch.pending.clear();
    watch.known.clear();
    this.setMissing(watch, true);
  }

  private async recheck(watch: FolderWatch): Promise<void> {
    if (watch.stopped) return;
    if (watch.missing) {
      await this.start(watch);
      return;
    }
    const st = await this.fsApi.stat(watch.folder);
    if (watch.stopped || st?.isDirectory) return;
    sendLog(`⚠️ [Flow] "${watch.folder}" is gone — "${watch.flowName}" waits for it to come back`);
    this.lose(watch);
  }

  private scheduleRescan(watch: FolderWatch): void {
    if (watch.stopped || watch.rescanTimer) return;
    watch.rescanTimer = setTimeout(() => {
      watch.rescanTimer = null;
      void this.rescan(watch);
    }, FILE_RESCAN_DEBOUNCE_MS);
    watch.rescanTimer.unref?.();
  }

  private async rescan(watch: FolderWatch): Promise<void> {
    if (watch.stopped) return;
    if (!watch.ready || watch.scanning) {
      watch.scanAgain = true;
      return;
    }
    watch.scanning = true;
    try {
      let current: Set<string>;
      try {
        current = await this.fsApi.list(watch.folder, watch.recursive);
      } catch {
        if (!watch.stopped) {
          sendLog(`⚠️ [Flow] "${watch.folder}" is gone — "${watch.flowName}" waits for it to come back`);
          this.lose(watch);
        }
        return;
      }
      if (watch.stopped) return;
      await this.diff(watch, current);
    } finally {
      watch.scanning = false;
      if (watch.scanAgain && !watch.stopped) {
        watch.scanAgain = false;
        this.scheduleRescan(watch);
      }
    }
  }

  private async diff(watch: FolderWatch, current: Set<string>): Promise<void> {
    const now = Date.now();
    for (const known of watch.known) {
      if (current.has(known)) continue;
      watch.known.delete(known);
      watch.vanished.set(known, now);
    }
    const arrived: string[] = [];
    for (const filePath of current) {
      if (watch.known.has(filePath)) continue;
      watch.known.add(filePath);
      const vanishedAt = watch.vanished.get(filePath);
      watch.vanished.delete(filePath);
      if (vanishedAt !== undefined && now - vanishedAt <= FILE_VANISH_GRACE_MS) continue;
      const name = path.basename(filePath);
      if (isTemporaryFileName(name) || !matchesWatchPattern(name, watch.patterns)) continue;
      if (this.insideTemporaryFolder(watch, filePath)) continue;
      if (!watch.pending.has(filePath)) arrived.push(filePath);
    }
    for (const [filePath, at] of watch.vanished) {
      if (now - at > FILE_VANISH_GRACE_MS) watch.vanished.delete(filePath);
    }
    for (const filePath of arrived) {
      const st = await this.fsApi.stat(filePath);
      if (watch.stopped) return;
      if (st?.isFile && !watch.pending.has(filePath)) this.awaitStable(watch, filePath, st);
    }
  }

  private awaitStable(watch: FolderWatch, filePath: string, first: WatchedFileStat): void {
    const pending: PendingFile = { last: first, unchanged: 0, since: Date.now(), timer: null };
    watch.pending.set(filePath, pending);
    const next = (): void => {
      pending.timer = setTimeout(() => void tick(), FILE_STABLE_POLL_MS);
      pending.timer.unref?.();
    };
    const drop = (): void => {
      watch.pending.delete(filePath);
    };
    const tick = async (): Promise<void> => {
      pending.timer = null;
      if (watch.stopped || watch.pending.get(filePath) !== pending) return;
      const st = await this.fsApi.stat(filePath);
      if (watch.stopped || watch.pending.get(filePath) !== pending) return;
      if (!st?.isFile) {
        drop();
        return;
      }
      if (Date.now() - pending.since > FILE_STABLE_GIVE_UP_MS) {
        sendLog(`⚠️ [Flow] "${path.basename(filePath)}" kept changing (or stayed empty) for ${FILE_STABLE_GIVE_UP_MS / 60_000} min — "${watch.flowName}" did not run for it`);
        drop();
        return;
      }
      // An empty file or a browser's partial beside it is a download that has not landed yet.
      const settled = st.size === pending.last.size && st.mtimeMs === pending.last.mtimeMs
        && st.size > 0 && !this.hasPartialSibling(watch, filePath);
      pending.unchanged = settled ? pending.unchanged + 1 : 0;
      pending.last = st;
      if (pending.unchanged < FILE_STABLE_CHECKS || !(await this.fsApi.canRead(filePath))) {
        if (!watch.stopped && watch.pending.get(filePath) === pending) next();
        return;
      }
      if (watch.stopped || watch.pending.get(filePath) !== pending) return;
      drop();
      this.dispatch(watch, filePath);
    };
    next();
  }

  /** In a download still in progress (Safari's "x.pdf.download/") or a hidden folder under the watched one. */
  private insideTemporaryFolder(watch: FolderWatch, filePath: string): boolean {
    const rel = path.relative(watch.folder, path.dirname(filePath));
    return rel !== '' && rel.split(path.sep).some(isTemporaryFolderName);
  }

  private hasPartialSibling(watch: FolderWatch, filePath: string): boolean {
    return PARTIAL_SIBLING_SUFFIXES.some((suffix) => watch.known.has(`${filePath}${suffix}`));
  }

  private dispatch(watch: FolderWatch, filePath: string): void {
    const queue = this.queues.get(watch.flowId);
    if (!queue) return;
    const now = Date.now();
    for (const [seen, at] of queue.recent) {
      if (now - at > FILE_REFIRE_WINDOW_MS) queue.recent.delete(seen);
    }
    if (queue.recent.has(filePath)) {
      sendLog(`📂 [Flow] "${path.basename(filePath)}" appeared again within ${FILE_REFIRE_WINDOW_MS / 1_000} s — "${watch.flowName}" already ran for it`);
      return;
    }
    if (queue.files.length >= MAX_PENDING_FILE_RUNS) {
      sendLog(`⚠️ [Flow] ${MAX_PENDING_FILE_RUNS} new files already wait for "${watch.flowName}" — skipped "${filePath}"`);
      return;
    }
    queue.recent.set(filePath, now);
    queue.files.push(filePath);
    this.pump(watch.flowId, queue);
  }

  /** One file at a time per flow: two runs of the same flow cannot overlap. */
  private pump(flowId: string, queue: FlowRunQueue): void {
    if (queue.busy || queue.detached) return;
    const filePath = queue.files.shift();
    if (!filePath) return;
    queue.busy = true;
    sendLog(`📂 [Flow] New file "${path.basename(filePath)}" — running "${queue.flowName}"`);
    void Promise.resolve()
      .then(() => this.fire(flowId, filePath))
      .catch((err: unknown) => {
        sendLog(`⚠️ [Flow] Run for "${filePath}" failed to start: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        queue.busy = false;
        if (this.queues.get(flowId) === queue) this.pump(flowId, queue);
      });
  }
}
