/**
 * Send log and duplicate guard.
 *
 * Every real send attempt is logged — time, recipient, the text's sha256 and length, the result —
 * but never the text. A PENDING line is written before the request; a later line with the same
 * client id records the outcome. An identical text to the same chat within 10 minutes that was (or
 * may have been) delivered is refused, so an interrupted send is not silently repeated.
 */
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tsToIso } from './schema';

export const DUPLICATE_WINDOW_MS = 10 * 60_000;
export const RESULT_PENDING = 'PENDING';

export interface SendLogEntry {
  time?: string;
  to: string;
  /** A reaction or unsend names its action and message; they are not text sends. */
  action?: string;
  message_id?: string;
  sha256: string;
  length: number;
  result: string;
  maybe_delivered?: boolean;
  server_message_id?: string;
  client_message_id?: string;
}

function logPath(dir: string): string {
  return join(dir, 'line-send-log.jsonl');
}

function mayHaveSent(e: SendLogEntry): boolean {
  return e.result === 'OK' || e.result === 'SEND_UNCERTAIN' || e.result === RESULT_PENDING || e.maybe_delivered === true;
}

/** How a logged attempt ended, as the duplicate messages word it. */
export function outcome(e: SendLogEntry): string {
  if (e.result === 'OK') return 'result OK';
  if (e.result === RESULT_PENDING) return 'interrupted before LINE answered, so it may have been delivered';
  return `result ${e.result}, so it may have been delivered`;
}

// One log line in line-cli's field order, leaving out the empty optional fields as Go's omitempty does.
function logLine(e: SendLogEntry, time: string): string {
  return JSON.stringify({
    time,
    to: e.to,
    ...(e.action ? { action: e.action } : {}),
    ...(e.message_id ? { message_id: e.message_id } : {}),
    sha256: e.sha256,
    length: e.length,
    result: e.result,
    ...(e.maybe_delivered ? { maybe_delivered: true } : {}),
    ...(e.server_message_id ? { server_message_id: e.server_message_id } : {}),
    ...(e.client_message_id ? { client_message_id: e.client_message_id } : {}),
  });
}

/** Appends one entry; `now` (epoch ms) stamps it unless the entry already has a time. */
export async function appendSendLog(dir: string, entry: SendLogEntry, now: number = Date.now()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await appendFile(logPath(dir), `${logLine(entry, entry.time || (tsToIso(now) ?? ''))}\n`, 'utf-8');
}

/**
 * The newest logged send of the same text to the same chat within the window that was, or may have
 * been, delivered. A line with an outcome replaces the PENDING line of the same client id.
 */
export async function recentDuplicate(dir: string, to: string, sha256: string, now: number): Promise<SendLogEntry | null> {
  let raw: string;
  try {
    raw = await readFile(logPath(dir), 'utf-8');
  } catch {
    return null;
  }
  const entries: SendLogEntry[] = [];
  const byClient = new Map<string, number>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let e: SendLogEntry;
    try {
      e = JSON.parse(line) as SendLogEntry;
    } catch {
      continue;
    }
    if (e.to !== to || e.sha256 !== sha256) continue;
    const clientId = e.client_message_id;
    if (clientId && byClient.has(clientId)) {
      entries[byClient.get(clientId) as number] = e;
      continue;
    }
    if (clientId) byClient.set(clientId, entries.length);
    entries.push(e);
  }
  let hit: SendLogEntry | null = null;
  for (const e of entries) {
    if (!mayHaveSent(e)) continue;
    const t = Date.parse(e.time ?? '');
    if (Number.isNaN(t) || now - t > DUPLICATE_WINDOW_MS) continue;
    hit = e;
  }
  return hit;
}

/** The DUPLICATE_SEND message for a prior send; the caller throws the LineError with it. */
export function duplicateMessage(dup: SendLogEntry): string {
  return `the same text was already sent, or possibly sent, to ${dup.to} at ${dup.time} (${outcome(dup)}); check with line_get_history with chat_id ${dup.to} and add allow_duplicate only if you really mean to send it again`;
}

/** The dry-run note for a text that a real send would refuse as a duplicate. */
export function duplicateNote(dup: SendLogEntry): string {
  return `note: the same text went to this chat at ${dup.time} (${outcome(dup)}); a real send will be refused with DUPLICATE_SEND unless allow_duplicate`;
}
