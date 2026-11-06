/**
 * LINE's server for the reads that need it (open chats and threads): the pause between calls, the
 * session that keeps every reply so a retry never asks the server twice, and the paging of a
 * thread's replies. The call itself is made by the native core. Read only.
 */
import { LineError, isLineError } from './errors';
import { emptyOnlineReport, ONLINE_BUDGET_SECONDS, timeIso, type OnlineReport } from './lineFreshness';
import {
  SQ_DIR_BACKWARD,
  SQUARE_PAGE_SIZE,
  SquareError,
  type FetchReply,
  type FetchRequest,
  type SquareMessage,
} from './lineSquare';
import type { NativeClientEnv, NativeSquareRequest, NativeSquareResult } from './nativeContract';
import { adaptMessage } from './nativeMessageAdapt';

/** Spaces the calls of one read, at a human pace. */
export const SQUARE_PAUSE_MS = 1200;
/** Caps the calls spent on one thread. */
export const MAX_THREAD_PAGES = 50;
/**
 * The most events a thread's first page has: the server gives at most the newest 50 forward
 * without a token.
 */
const THREAD_FORWARD_WINDOW = 50;
/**
 * Yobi only: the time one tool call may spend calling LINE's server. The MCP client gives up on a
 * tool call after 120 s, and then nothing read would reach the model.
 */
const ONLINE_BUDGET_MS = ONLINE_BUDGET_SECONDS * 1000;

/** One read of LINE's server. The server refusing throws SquareError; anything else a plain Error saying why. */
export type SquareCaller = (q: FetchRequest) => Promise<FetchReply>;

const TOKEN_HINT = 'make sure LINE is running and signed in, use it briefly, then retry';

export interface SquareCallerDeps {
  /** Access-token candidates from LINE's memory, most frequent first. */
  tokens: string[];
  clientEnv: NativeClientEnv;
  fetch: (req: NativeSquareRequest) => Promise<NativeSquareResult>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Reads through the native core. The first call tries the token candidates until one is accepted,
 * which later calls reuse; calls are spaced by SQUARE_PAUSE_MS. Reading is idempotent, so unlike
 * send any failure may be retried by reading again.
 */
export function squareCaller(deps: SquareCallerDeps): SquareCaller {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let token = '';
  let calls = 0;
  return async (query) => {
    if (calls > 0) await sleep(SQUARE_PAUSE_MS);
    calls++;
    const res = await deps.fetch({ query, tokens: deps.tokens, clientEnv: deps.clientEnv, ...(token ? { token } : {}) });
    token = deps.tokens[res.tokenIndex] ?? token;
    if (res.refused) throw new SquareError(res.refused.app, res.refused.code, res.refused.reason);
    if (res.outcome !== 'ok' || !res.reply) throw new Error(adaptMessage(res.reason || res.outcome));
    return res.reply;
  };
}

/** Connects to LINE's server with the access tokens LINE holds in memory (TOKEN_NOT_FOUND when there are none). */
export async function connectSquare(deps: Omit<SquareCallerDeps, 'tokens'> & { tokens: () => Promise<string[]> }): Promise<SquareCaller> {
  const tokens = await deps.tokens();
  if (tokens.length === 0) throw new LineError('TOKEN_NOT_FOUND', `no access token candidates; ${TOKEN_HINT}`);
  return squareCaller({ ...deps, tokens });
}

/**
 * LINE's server for one tool call: the connection and every reply, kept across the attempts of the
 * call, so reading again does not ask the server the same things again.
 */
export class Session {
  caller: SquareCaller | null = null;
  /** Why LINE's server cannot be used. */
  down = '';
  /** Yobi only: the call's time budget ran out or the caller cancelled, so no more calls. */
  stopped = false;
  readonly replies = new Map<string, FetchReply | SquareError>();
  calls = 0;
}

export interface OnlineOptions {
  enabled: boolean;
  /** Threads whose replies one read of an open chat fetches (0 = the default 20). */
  maxThreads?: number;
  /** Progress lines ("reading thread 2/5 …"). */
  notify?: (line: string) => void;
  session?: Session;
  /** Opens the transport on the first call that needs it. */
  connect?: () => Promise<SquareCaller>;
  signal?: AbortSignal;
  now?: () => number;
  budgetMs?: number;
}

/**
 * One read's access to LINE's server, through its session: it connects on first use and, after a
 * failure that is not about one chat, makes no further calls.
 */
export class OnlineServer {
  readonly report: OnlineReport = emptyOnlineReport();
  readonly session: Session;
  readonly notify: (line: string) => void;
  private readonly deadline: number;
  private readonly now: () => number;

  constructor(readonly opt: OnlineOptions) {
    this.session = opt.session ?? new Session();
    this.notify = opt.notify ?? (() => {});
    this.now = opt.now ?? Date.now;
    this.deadline = this.now() + (opt.budgetMs ?? ONLINE_BUDGET_MS);
  }

  /** The report with the session's call count. */
  finalReport(): OnlineReport {
    return { ...this.report, calls: this.session.calls };
  }

  isDown(): boolean {
    return this.session.down !== '' || this.session.stopped;
  }

  failed(id: string, se: SquareError): void {
    this.report.failed.push(`${id}: ${se.message}`);
  }

  private fail(err: unknown): Error {
    const why = isLineError(err) ? err.message : err instanceof Error ? err.message : String(err);
    this.session.down = why;
    this.report.unavailable = why;
    return SERVER_DOWN;
  }

  /**
   * One call, or its answer from the session. The server refusing concerns the
   * chat or thread asked for and comes back as SquareError; any other failure takes the server down
   * for the rest of the tool call, recording why.
   */
  async call(q: FetchRequest): Promise<FetchReply> {
    const s = this.session;
    const key = JSON.stringify([q.chatMid, q.threadMid ?? '', q.syncToken ?? '', q.continuation ?? '', q.limit, q.direction ?? 0]);
    let answer = s.replies.get(key);
    if (!answer) {
      if (s.down) {
        this.report.unavailable = s.down;
        throw SERVER_DOWN;
      }
      if (s.stopped || this.opt.signal?.aborted || this.now() >= this.deadline) {
        if (!s.stopped) this.report.timeUp = !this.opt.signal?.aborted;
        s.stopped = true;
        throw SERVER_DOWN;
      }
      if (!s.caller) {
        if (!this.opt.connect) throw this.fail(new Error('this app cannot reach LINE\'s server here'));
        try {
          s.caller = await this.opt.connect();
        } catch (err) {
          throw this.fail(err);
        }
      }
      try {
        answer = await s.caller(q);
      } catch (err) {
        if (!(err instanceof SquareError)) throw this.fail(err);
        answer = err;
      } finally {
        s.calls++;
      }
      s.replies.set(key, answer);
    }
    if (answer instanceof SquareError) throw answer;
    // A copy: what the session keeps stays as the server gave it.
    return structuredClone(answer);
  }

  /**
   * A thread's replies, newest first. Forward without a token, the server gives only the newest
   * events (at most THREAD_FORWARD_WINDOW) and a sync token at the newest one; backward from it,
   * following each page's sync and continuation tokens, it gives the older ones until a page has no
   * continuation token. Reading stops there, once replies are older than loMs (0 = all), or after
   * MAX_THREAD_PAGES calls. What was read comes back with the error when a call fails.
   *
   * The server drops old thread events, so a thread
   * can have fewer replies than LINE counts; read to the end, the shortfall goes in the report.
   */
  async thread(t: ThreadMeta, loMs: number): Promise<{ replies: SquareMessage[]; err?: unknown }> {
    const out: SquareMessage[] = [];
    const seen = new Set<string>();
    let oldest = 0;
    const add = (rep: FetchReply): void => {
      for (const m of rep.messages) {
        if ((m.threadMid !== '' && m.threadMid !== t.id) || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
        const created = m.row._createdTime ?? 0;
        if (oldest === 0 || created < oldest) oldest = created;
      }
    };
    let rep: FetchReply;
    try {
      rep = await this.call({ chatMid: t.chat, threadMid: t.id, limit: SQUARE_PAGE_SIZE });
    } catch (err) {
      return { replies: out, err };
    }
    add(rep);
    // The first page is all there is when it is not full and has what LINE counts (LINE's count
    // alone may be out of date).
    let end = rep.events === 0 || (rep.events < THREAD_FORWARD_WINDOW && out.length >= t.replies);
    let sync = rep.syncToken;
    let cont = '';
    for (let page = 1; !end; page++) {
      if (loMs > 0 && oldest > 0 && oldest < loMs) return { replies: out };
      if (sync === '' || page >= MAX_THREAD_PAGES) {
        this.report.cut.push(`${t.id}: stopped after ${page} calls at ${timeIso(oldest)}`);
        return { replies: out };
      }
      try {
        rep = await this.call({ chatMid: t.chat, threadMid: t.id, syncToken: sync, continuation: cont, direction: SQ_DIR_BACKWARD, limit: SQUARE_PAGE_SIZE });
      } catch (err) {
        return { replies: out, err };
      }
      add(rep);
      end = rep.events === 0 || rep.continuation === '' || (rep.syncToken === sync && rep.continuation === cont);
      sync = rep.syncToken;
      cont = rep.continuation;
    }
    const short = t.replies - out.length;
    if (short > 0) {
      this.report.shortThreads++;
      this.report.shortReplies += short;
    }
    return { replies: out };
  }
}

/** The error a call gets once LINE's server is down for the rest of the tool call; the report says why. */
export const SERVER_DOWN = new Error("LINE's server is not available");

/** A thread's row in _squareThread. */
export interface ThreadMeta {
  id: string;
  chat: string;
  rootId: string;
  lastAt: number;
  replies: number;
  /** The root message's _createdTime, 0 when not stored. */
  rootAt: number;
}
