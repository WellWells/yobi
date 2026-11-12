/**
 * Watches LINE PC's database for what is written in groups: each time LINE writes (the database or
 * its WAL changes), a fresh read-only handle takes the group messages stored since the last look —
 * the user's own in any chat (their "Yobi" in a 1:1 chat), and the other side's "Yobi" lines in a
 * 1:1 chat, nothing else of theirs (`watchedMessagesAfter`). Everything already stored when it
 * starts is history and never answered.
 */
import { statSync } from 'node:fs';
import { latestMessageMark, watchedMessagesAfter, type MessageMark, type WatchedMessage } from '../line/ownMessages';
import type { LineReader } from '../line/reader';

/** LINE stores a message about two seconds after it is sent; checking more often buys nothing. */
export const LINE_SELF_POLL_MS = 1_500;
const READ_LIMIT = 200;
/** How long a row LINE has not given its server id yet may hold reading back (a send in flight). */
const PENDING_HOLD_MS = 120_000;
const HANDLED_IDS_KEPT = 2_000;
const SERVER_ID_RE = /^\d+$/u;

export interface LineSelfStore {
  /** A new read-only handle on the database (sees what LINE wrote since); the caller closes it. */
  openFresh: () => Promise<{ reader: LineReader; close: () => void }>;
  /** The located database file, once a read opened it. */
  databasePath: () => Promise<string | null>;
}

export interface LineSelfWatcherDeps {
  store: LineSelfStore;
  /** The user's own id: their rows are marked `from_me`, and read in every chat. */
  ownMid: string;
  onMessages: (messages: WatchedMessage[]) => Promise<void>;
  onLog: (message: string) => void;
  /** A file's write time in ms, 0 when it cannot be read. */
  statMs?: (path: string) => number;
  now?: () => number;
  intervalMs?: number;
}

function fileWriteMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export class LineSelfWatcher {
  private mark: MessageMark = { byRow: false, rowId: 0, createdMs: 0 };
  private readonly handled = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWrite = '';
  private running = false;
  private readonly statMs: (path: string) => number;
  private readonly now: () => number;

  constructor(private readonly deps: LineSelfWatcherDeps) {
    this.statMs = deps.statMs ?? fileWriteMs;
    this.now = deps.now ?? Date.now;
  }

  /** Takes the newest stored row as the starting point, then checks on an interval. */
  async start(): Promise<void> {
    this.mark = await this.read((reader) => latestMessageMark(reader.access()));
    this.lastWrite = await this.writeStamp();
    this.timer = setInterval(() => { void this.tick(); }, this.deps.intervalMs ?? LINE_SELF_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.handled.clear();
  }

  /** One look (the interval's; tests call it directly). Overlapping calls are dropped. */
  async tick(force = false): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const stamp = await this.writeStamp();
      if (!force && stamp === this.lastWrite) return;
      const rows = await this.read((reader) => watchedMessagesAfter(reader.access(), this.mark, {
        ownIds: new Set([this.deps.ownMid]),
        limit: READ_LIMIT,
      }));
      // A full page may leave more behind: the next look reads on even without a new write.
      if (rows.length < READ_LIMIT) this.lastWrite = stamp;
      const fresh = this.advance(rows);
      if (fresh.length > 0) await this.deps.onMessages(fresh);
    } catch (err: unknown) {
      this.deps.onLog(`[lineSelf] reading LINE's database failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Moves the mark past these rows and returns the ones to handle. A row LINE has not given its
   * server id yet (a send still in flight) holds the mark back, so the row is read again once LINE
   * updates it; an id handled before is never handed on twice.
   */
  private advance(rows: WatchedMessage[]): WatchedMessage[] {
    const out: WatchedMessage[] = [];
    let hold: WatchedMessage | null = null;
    for (const row of rows) {
      const id = row.message.id ?? '';
      if (!SERVER_ID_RE.test(id)) {
        if (!hold && this.now() - row.createdMs < PENDING_HOLD_MS) hold = row;
        continue;
      }
      if (this.handled.has(id)) continue;
      this.handled.add(id);
      if (this.handled.size > HANDLED_IDS_KEPT) this.handled.delete(this.handled.values().next().value as string);
      out.push(row);
    }
    const last = rows[rows.length - 1];
    if (hold) {
      this.mark = { ...this.mark, rowId: Math.max(hold.rowId - 1, 0), createdMs: hold.createdMs - 1 };
    } else if (last) {
      this.mark = { ...this.mark, rowId: last.rowId, createdMs: Math.max(this.mark.createdMs, last.createdMs) };
    }
    return out;
  }

  private async writeStamp(): Promise<string> {
    const path = await this.deps.store.databasePath();
    return path ? `${this.statMs(path)}|${this.statMs(`${path}-wal`)}` : '';
  }

  private async read<T>(fn: (reader: LineReader) => T): Promise<T> {
    const { reader, close } = await this.deps.store.openFresh();
    try {
      return fn(reader);
    } finally {
      close();
    }
  }
}
