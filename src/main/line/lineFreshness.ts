/**
 * How far a chat's stored messages lag behind what LINE knows of it, and the notes that say so.
 * The note texts are line-cli's, with its flags and commands named as this connector's tools and parameters
 * (TOOL_WORDS), and without line-cli's `line: ` stderr prefix.
 */
import { tsToIso } from './schema';
import { readCall, TOOL_WORDS } from './lineNotes';

export { readCall, TOOL_WORDS } from './lineNotes';

/** A read of the LINE database: rows, or none when a table or column is missing. */
export type Query = (sql: string, params?: unknown[]) => Record<string, unknown>[];

/** How far LINE's last activity may run ahead of the newest stored message before a chat counts as not synced. */
export const STALE_SLACK_MS = 60_000;

/**
 * What LINE knows about a chat (_chat._lastMessage and _lastUpdatedTime) next to the messages stored
 * on this PC. Times are unix ms.
 */
export interface Freshness {
  chatId: string;
  lastActivity: number;
  /** _lastMessage.id is not in _message. */
  lastMissing: boolean;
  newestStored: number;
  oldestStored: number;
  /** The oldest stored message's id (chatFreshness only). */
  oldestId: string;
}

/** sent_at of unix ms (or seconds); '' for 0. */
export function timeIso(ms: number): string {
  return ms ? (tsToIso(ms) ?? '') : '';
}

/** An inclusive `until` in unix seconds as a millisecond bound covering that whole second. */
export function untilMs(sec: number): number {
  return sec * 1000 + 999;
}

/** LINE knows of activity the local database does not hold. */
export function isStale(f: Freshness): boolean {
  return f.lastMissing || f.lastActivity > f.newestStored + STALE_SLACK_MS;
}

/** LINE knows of activity later than the newest stored message (a last message merely not stored does not count). */
export function isBehind(f: Freshness): boolean {
  return f.lastActivity > f.newestStored + STALE_SLACK_MS;
}

/**
 * Whether a range ending at untilSec (unix seconds, 0 = now) reaches past the newest stored message
 * into the chat's unsynced activity. With nothing stored, only a range reaching LINE's last activity does.
 */
export function staleFor(f: Freshness, untilSec: number): boolean {
  if (!isStale(f) || untilSec === 0) return isStale(f);
  if (f.newestStored === 0) return untilMs(untilSec) >= f.lastActivity;
  return untilMs(untilSec) > f.newestStored + STALE_SLACK_MS;
}

function columnsOf(query: Query, table: string): Set<string> {
  return new Set(query(`SELECT name FROM pragma_table_info('${table}')`).map((row) => String(row.name)));
}

// A column this DB lacks (an older build, a minimal fixture) reads as NULL.
function chatStateSql(query: Query): string {
  const chat = columnsOf(query, '_chat');
  const lm = chat.has('_lastMessage') ? '_lastMessage' : 'NULL';
  const lu = chat.has('_lastUpdatedTime') ? '_lastUpdatedTime' : 'NULL';
  const missing = columnsOf(query, '_message').has('_id') ? "lid<>'' AND NOT EXISTS(SELECT 1 FROM _message m WHERE m._id=x.lid)" : '0';
  return `SELECT _id, max(coalesce(lu,0), lct) AS activity, ${missing} AS missing,
 coalesce((SELECT max(_createdTime) FROM _message m WHERE m._chatId=x._id),0) AS newest,
 coalesce((SELECT min(_createdTime) FROM _message m WHERE m._chatId=x._id),0) AS oldest
FROM (SELECT _id, ${lu} AS lu,
 CASE WHEN json_valid(${lm}) THEN coalesce(json_extract(${lm},'$.id'),'') ELSE '' END AS lid,
 CASE WHEN json_valid(${lm}) THEN coalesce(json_extract(${lm},'$.createdTime'),0) ELSE 0 END AS lct
 FROM _chat WHERE ? IN ('', _id)) x
ORDER BY 2 DESC`;
}

/** The freshness of one chat, or of every chat (newest activity first) when chatId is ''. */
export function chatStates(query: Query, chatId = ''): Freshness[] {
  return query(chatStateSql(query), [chatId]).map((row) => ({
    chatId: String(row._id ?? ''),
    lastActivity: Number(row.activity) || 0,
    lastMissing: (Number(row.missing) || 0) !== 0,
    newestStored: Number(row.newest) || 0,
    oldestStored: Number(row.oldest) || 0,
    oldestId: '',
  }));
}

/** One chat's freshness, or null when it has no _chat row. */
export function freshness(query: Query, chatId: string): Freshness | null {
  return chatStates(query, chatId)[0] ?? null;
}

/** freshness plus the oldest stored message's id, for the notes on what span of a chat is stored. */
export function chatFreshness(query: Query, chatId: string): Freshness | null {
  const f = freshness(query, chatId);
  if (!f || f.oldestStored === 0) return f;
  const row = query('SELECT _id FROM _message WHERE _chatId=? ORDER BY _createdTime ASC LIMIT 1', [chatId])[0];
  f.oldestId = String(row?._id ?? '');
  return f;
}

export interface ChatOption {
  hidden: boolean;
  muted: boolean;
}

/** _chatOption: _hidden=1 hides a chat from LINE's list and _notification=0 mutes it. A missing table yields none. */
export function chatOptions(query: Query): Map<string, ChatOption> {
  const out = new Map<string, ChatOption>();
  for (const row of query('SELECT _id, _hidden, _notification FROM _chatOption')) {
    out.set(String(row._id ?? ''), { hidden: Number(row._hidden) === 1, muted: row._notification != null && Number(row._notification) === 0 });
  }
  return out;
}

/** An open chat id (m…). */
export function isOpenChat(id: string): boolean {
  return id.startsWith('m');
}

/** A thread chat id (t…): LINE keeps thread replies on the server, so such a chat always looks stale. */
export function isThreadChat(id: string): boolean {
  return id.startsWith('t');
}

/**
 * How to get, from LINE's server, what a note says this PC does not store: 'read' = another tool
 * (line_get_history gets it), 'offline' = offline: true was given, 'none' = this tool tried LINE's
 * server and its own note says why it failed.
 */
export type ServerHint = 'read' | 'offline' | 'none';

/** The clause after a note about what this PC does not store (open chats and threads only). */
export function serverAdvice(chatId: string, hint: ServerHint): string {
  if (!isThreadChat(chatId) && !isOpenChat(chatId)) return '';
  const what = isOpenChat(chatId) ? 'the missing messages' : 'them';
  if (hint === 'read') return `${readCall(chatId)} reads ${what} from LINE's server`;
  if (hint === 'offline') return `without ${TOOL_WORDS.offline}, ${TOOL_WORDS.self} reads ${what} from LINE's server`;
  return '';
}

/** What a read of an open chat from this PC alone left out; '' when nothing. */
export function threadsNotReadNote(chatId: string, threads: number, replies: number, hint: ServerHint): string {
  if (threads === 0) return '';
  const note = `note: the output has no replies from ${threads} thread(s) active in this span (${replies} replies by LINE's count): LINE for PC does not store thread replies`;
  const advice = serverAdvice(chatId, hint);
  return advice ? `${note}; ${advice}` : note;
}

/** The note on a chat LINE knows of activity in that this PC does not store. */
export function staleNote(chatId: string, f: Freshness, hint: ServerHint): string {
  const activity = timeIso(f.lastActivity) || 'a message that is not stored';
  const newest = timeIso(f.newestStored);
  const stored = newest ? `the newest stored message is ${newest}` : 'no stored messages';
  const advice = serverAdvice(chatId, hint);
  if (isThreadChat(chatId)) {
    const n = `note: thread chat ${chatId} has activity up to ${activity} but ${stored}; thread replies are not stored on this PC`;
    return advice ? `${n}; ${advice}` : n;
  }
  const n = `note: chat ${chatId} has activity up to ${activity} but ${stored}; open the chat in LINE to sync`;
  return advice ? `${n}, or ${advice}` : n;
}

/**
 * The note on what span of a chat is stored when a read came back empty, or that it reached the
 * oldest stored message from an earlier start ('' = none). `shownIds` are the ids of the messages
 * the read returned (for an open chat, its own messages). For a thread it adds that LINE for PC
 * does not store thread replies.
 */
export function historyNote(
  chatId: string,
  f: Freshness | null,
  shownIds: readonly (string | undefined)[],
  sinceSec: number,
  untilSec: number,
  hint: ServerHint,
): string {
  const n = storedSpanNote(chatId, f, shownIds, sinceSec, untilSec);
  if (!n || !isThreadChat(chatId)) return n;
  const advice = serverAdvice(chatId, hint);
  return `${n}; LINE for PC does not store thread replies${advice ? `: ${advice}` : ''}`;
}

function storedSpanNote(chatId: string, f: Freshness | null, shownIds: readonly (string | undefined)[], sinceSec: number, untilSec: number): string {
  if (!f) return '';
  if (f.oldestStored === 0) {
    // The stale note already says nothing is stored.
    return staleFor(f, untilSec) ? '' : `note: chat ${chatId} has no messages stored on this PC`;
  }
  const oldest = timeIso(f.oldestStored);
  if (shownIds.length === 0) {
    const n = `note: chat ${chatId} has no stored messages in this range; its stored messages span ${oldest} to ${timeIso(f.newestStored)}`;
    return untilSec !== 0 && untilMs(untilSec) < f.oldestStored ? `${n}; older history is not on this PC` : n;
  }
  if (sinceSec !== 0 && sinceSec >= Math.floor(f.oldestStored / 1000)) return '';
  // A row without an id (a minimal fixture) is never the oldest one.
  if (f.oldestId && shownIds.includes(f.oldestId)) {
    return `note: reached the oldest message stored for chat ${chatId} (${oldest}); older history is not on this PC`;
  }
  return '';
}

/** What one read or unread got from LINE's server. */
export interface OnlineReport {
  /** Calls to LINE's server. */
  calls: number;
  /** Threads whose replies were read. */
  threads: number;
  /** Threads with replies in the span beyond max_threads. */
  threadsLeft: number;
  /** Open-chat messages this PC does not store, read from the server. */
  missing: number;
  /** Chats or threads LINE's server would not return, with why. */
  failed: string[];
  /** Chats and threads whose messages were not all read, with why. */
  cut: string[];
  /** Why LINE's server could not be used: the rest is what this PC stores. */
  unavailable: string;
  /** Threads read to the end with fewer replies than LINE counts, and how many fewer in all. */
  shortThreads: number;
  shortReplies: number;
  /** Yobi only: the tool call's time for LINE's server ran out before everything was read. */
  timeUp: boolean;
}

export function emptyOnlineReport(): OnlineReport {
  return { calls: 0, threads: 0, threadsLeft: 0, missing: 0, failed: [], cut: [], unavailable: '', shortThreads: 0, shortReplies: 0, timeUp: false };
}

/** Yobi only: the seconds one tool call may spend calling LINE's server (the MCP client gives up at 120). */
export const ONLINE_BUDGET_SECONDS = 75;

/** The most threads one read of an open chat accepts (max_threads). */
export const MAX_READ_THREADS = 100;

/** What read or unread got from LINE's server, and what it could not get. */
export function onlineNotes(rep: OnlineReport): string[] {
  const out: string[] = [];
  if (rep.unavailable) out.push(`note: LINE's server could not be reached, so the output has only what this PC stores: ${rep.unavailable}`);
  if (rep.timeUp) {
    out.push(`note: stopped reading from LINE's server after ${ONLINE_BUDGET_SECONDS} seconds, the most one call of ${TOOL_WORDS.self} spends there, so not everything this PC lacks was read; narrow ${TOOL_WORDS.since}/${TOOL_WORDS.until} or lower ${TOOL_WORDS.maxThreads}`);
  }
  for (const f of rep.failed) out.push(`note: LINE's server did not return ${f}`);
  for (const c of rep.cut) {
    out.push(isThreadChat(c)
      ? `note: not every reply was read from LINE's server for thread ${c}; narrow ${TOOL_WORDS.since}`
      : `note: not every message this PC lacks was read from LINE's server for ${c}; open the chat in LINE to sync it`);
  }
  if (rep.shortThreads > 0) {
    out.push(`note: LINE's server has ${rep.shortReplies} fewer replies than LINE counts in ${rep.shortThreads} thread(s): it no longer keeps replies older than about 5 months, and LINE's count can include replies that were removed`);
  }
  if (rep.threadsLeft > 0) {
    out.push(`note: ${rep.threadsLeft} more thread(s) may have replies in this span and were not read; narrow ${TOOL_WORDS.since}/${TOOL_WORDS.until} or raise ${TOOL_WORDS.maxThreads} (at most ${MAX_READ_THREADS})`);
  }
  if (rep.calls === 0) return out;
  const got: string[] = [];
  if (rep.missing > 0) got.push(`${rep.missing} message(s) this PC does not store`);
  if (rep.threads > 0) got.push(`the replies of ${rep.threads} thread(s)`);
  if (got.length === 0) got.push('nothing new');
  out.push(`note: read ${got.join(' and ')} from LINE's server in ${rep.calls} call(s); ${TOOL_WORDS.search} and ${TOOL_WORDS.stats} do not see them`);
  return out;
}
