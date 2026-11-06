/**
 * line_status and the "LINE is not running" note. Status uses only a cached key: it never scans LINE's memory or contacts
 * LINE, so it works while LINE is closed and says how stale the stored data is.
 */
import { statSync } from 'node:fs';
import { tsToIso } from './schema';

/** The stored-message span and stale chats, as the reader reports them. */
export interface StatusSpan {
  newest_message_at?: string | null;
  oldest_message_at?: string | null;
  stale_chats?: { count: number; chat_ids: string[] };
}

/** The status report, in line-cli's field order; database fields are left out without a usable key. */
export interface LineStatusReport {
  line_running: boolean;
  db_path: string;
  db_size: number;
  db_modified_at?: string;
  wal_modified_at?: string;
  key_cached: boolean;
  newest_message_at?: string;
  oldest_message_at?: string;
  stale_chats?: { count: number; chat_ids: string[] };
  note?: string;
}

export interface DbFiles {
  size: number;
  modMs: number;
  walMs: number;
}

function mtimeMs(path: string): { size: number; ms: number } {
  try {
    const st = statSync(path);
    return { size: st.size, ms: st.mtimeMs };
  } catch {
    return { size: 0, ms: 0 };
  }
}

export function statDbFiles(mainEdb: string): DbFiles {
  const main = mtimeMs(mainEdb);
  return { size: main.size, modMs: main.ms, walMs: mtimeMs(`${mainEdb}-wal`).ms };
}

/** The newer of the database and WAL write times: the local data changes only while LINE runs. */
export function dataAsOf(files: DbFiles): string {
  return tsToIso(Math.max(files.modMs, files.walMs)) || 'unknown';
}

/** The LINE-stopped note, printed first by every database command. */
export function stoppedNote(running: boolean | null, files: () => DbFiles | null): string[] {
  if (running !== false) return [];
  const f = files();
  return f ? [`note: LINE is not running; data is as of ${dataAsOf(f)}`] : [];
}

const NOT_LISTED = 'Could not list processes to check for LINE.';
const NOT_RUNNING = 'LINE is not running; the database only updates while LINE runs and syncs.';
const NO_KEY = "No usable cached key; the next read command scans LINE's memory for it (LINE must be running).";

export function buildStatus(input: {
  dbPath: string;
  files: DbFiles;
  running: boolean | null;
  /** The reader's span, or null when no cached key opens the database. */
  span: StatusSpan | null;
}): LineStatusReport {
  const { files, running, span } = input;
  let note = running === null ? NOT_LISTED : running ? '' : NOT_RUNNING;
  if (!span) note = `${note} ${NO_KEY}`.trim();
  const dbModified = tsToIso(files.modMs);
  const walModified = tsToIso(files.walMs);
  return {
    line_running: running === true,
    db_path: input.dbPath,
    db_size: files.size,
    ...(dbModified ? { db_modified_at: dbModified } : {}),
    ...(walModified ? { wal_modified_at: walModified } : {}),
    key_cached: span !== null,
    ...(span?.newest_message_at ? { newest_message_at: span.newest_message_at } : {}),
    ...(span?.oldest_message_at ? { oldest_message_at: span.oldest_message_at } : {}),
    ...(span?.stale_chats ? { stale_chats: span.stale_chats } : {}),
    ...(note ? { note } : {}),
  };
}
