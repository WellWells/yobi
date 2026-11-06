/**
 * What one read of LINE's server for an open chat asks and gets back. The native core makes the
 * call and returns message rows shaped like the ones LINE for PC stores in _message, so
 * parseMessageRow reads them exactly as it reads stored ones. Read only.
 */
import type { MessageRow } from './schema';

/** The events asked for per call; the server refuses much larger pages. */
export const SQUARE_PAGE_SIZE = 100;

export const SQ_DIR_BACKWARD = 2;
export const SQ_MSG_STATE_DELETED = 2;
export const SQ_MSG_STATE_UNSENT = 4;

/**
 * One request. A thread is read with its threadMid: forward without a token, then backward from the
 * sync token with each page's continuation token.
 */
export interface FetchRequest {
  chatMid: string;
  threadMid?: string;
  syncToken?: string;
  continuation?: string;
  limit: number;
  /** 0 or absent = forward. */
  direction?: number;
}

/** One message of a reply. */
export interface SquareMessage {
  /** The message as LINE for PC would store it, for parseMessageRow. */
  row: MessageRow;
  id: string;
  chatMid: string;
  threadMid: string;
  threadRoot: boolean;
  state: number;
}

export interface FetchReply {
  messages: SquareMessage[];
  /** All events, messages or not. */
  events: number;
  /** The newest event's createdTime (ms), messages or not. */
  lastEventAt: number;
  syncToken: string;
  continuation: string;
}

function clip(s: string, n: number): string {
  const runes = [...s];
  return runes.length <= n ? s : `${runes.slice(0, n).join('')}...`;
}

/** The server refused the request; `app` is a protocol-level refusal. */
export class SquareError extends Error {
  constructor(readonly app: boolean, readonly code: number, readonly reason: string) {
    super(app
      ? `TApplicationException type ${code}: ${JSON.stringify(clip(reason, 200))}`
      : `SquareException code ${code}, reason ${JSON.stringify(clip(reason, 200))}`);
    this.name = 'SquareError';
  }
}
