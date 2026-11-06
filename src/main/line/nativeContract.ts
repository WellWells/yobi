/**
 * TypeScript mirror of the native core's C-ABI JSON contract. Field names must
 * match the Go side exactly. Requests carry secrets (tokens, E2EE keys): never log or persist them.
 */

import type { MessageRow } from './schema';

export const NATIVE_CORE_UNAVAILABLE = 'NATIVE_CORE_UNAVAILABLE' as const;
/** How that error's message starts: what `localizeUserFacingError` looks for. */
export const NATIVE_CORE_UNAVAILABLE_TEXT = 'LINE native send core is unavailable';

/** The core contract this build speaks; another version is refused at load. */
export const NATIVE_CORE_VERSION = '1.0.0';

/** `dataDir` (LINE's data folder), and for tests version, osVer and locale themselves. */
export type NativeClientEnv = Record<string, string>;

/** The stored key columns of one chat, and whether it has a row. */
export interface NativeKeysRequest {
  chatId: string;
  keychain: string;
  publicKeys: string;
  found: boolean;
  enabled: boolean;
}

export interface NativeKeysResult {
  state: 'ready' | 'no_key' | 'disabled' | 'failed';
  version: number;
  keys?: NativeSendKeys;
  code?: string;
  reason?: string;
}

/** One read of LINE's server. */
export interface NativeSquareQuery {
  chatMid: string;
  threadMid?: string;
  syncToken?: string;
  continuation?: string;
  limit: number;
  direction?: number;
}

export interface NativeSquareRequest {
  query: NativeSquareQuery;
  tokens: string[];
  /** The token LINE accepted earlier in this read; then the only one tried. */
  token?: string;
  clientEnv?: NativeClientEnv;
}

export interface NativeSquareMessage {
  row: MessageRow;
  id: string;
  chatMid: string;
  threadMid: string;
  threadRoot: boolean;
  state: number;
}

export interface NativeSquareReply {
  messages: NativeSquareMessage[];
  events: number;
  lastEventAt: number;
  syncToken: string;
  continuation: string;
}

export interface NativeSquareResult {
  outcome: 'ok' | 'refused' | 'failed';
  /** Index in `tokens` of the token LINE accepted; -1 when none is known. */
  tokenIndex: number;
  reply?: NativeSquareReply;
  refused?: { app: boolean; code: number; reason: string };
  reason?: string;
}

export type NativeActionName = 'react' | 'remove_reaction' | 'unsend';

/** One react, remove_reaction or unsend. */
export interface NativeActionRequest {
  action: NativeActionName;
  chatId: string;
  messageId: string;
  /** The predefined reaction code of a react. */
  reaction?: number;
  /** A new number for each action: LINE matches a request and its retries by it. */
  seq: number;
  clientId: string;
  clientEnv?: NativeClientEnv;
  tokens: string[];
}

export interface NativeActionResult {
  outcome: NativeOutcome;
  /** A line error when the call did not succeed. */
  code?: string;
  reason?: string;
}

export interface NativeSendKeys {
  myPrivB64: string;
  myKeyId: number;
  recvKeyId: number;
  recvPubB64?: string;
  groupPrivB64?: string;
}

export interface NativeSendRequest {
  chatId: string;
  from: string;
  version: 1 | 2;
  /** 0 = user, 2 = group. */
  toType: 0 | 2;
  /** 0 = text. */
  contentType: number;
  text: string;
  keys: NativeSendKeys;
  clientId: string;
  createdTime: number;
  relatedId?: string;
  clientEnv?: NativeClientEnv;
  tokens: string[];
  dryRun: boolean;
  randomSeedB64?: string;
}

/** One file of a native file send; one file = one LINE message. */
export interface NativeSendFileRequest {
  chatId: string;
  from: string;
  /** 0 = user, 2 = group. */
  toType: 0 | 2;
  keys: NativeSendKeys;
  clientId: string;
  createdTime: number;
  relatedId?: string;
  clientEnv: NativeClientEnv;
  tokens: string[];
  file: {
    path: string;
    name: string;
    ext: string;
    /** 1 image, 2 video, 14 file. */
    contentType: number;
    bytes: number;
    previewB64?: string;
    width?: number;
    height?: number;
    durationMs?: number;
  };
  /** gid is the decimal album group id computed in TypeScript; seq is 1-based. */
  album?: { gid: string; seq: number; total: number };
  dryRun: boolean;
  randomSeedB64?: string;
}

export interface NativeDownloadRequest {
  sid: string;
  oid: string;
  messageId: string;
  /** The message's keyMaterial (base64), taken from the local DB. */
  keyMaterialB64: string;
  tokens: string[];
  clientEnv: NativeClientEnv;
  /** Where the core writes the decrypted file (temp + rename). */
  targetPath: string;
  maxBytes?: number;
}

export interface NativeDownloadResult {
  status: 'downloaded' | 'http_error' | 'decrypt_failed' | 'auth' | 'blocked' | 'no_body';
  bytes: number;
  acceptedTokenIndex: number;
  code: string;
  reason: string;
}

export type NativeOutcome =
  | 'ok'
  | 'auth'
  | 'not_sent'
  | 'blocked'
  | 'failed'
  | 'server_error'
  | 'uncertain'
  | 'dryrun';

export interface NativeSendResult {
  chunkSizes: number[];
  bodyBytes: number;
  senderKeyId: number;
  receiverKeyId: number;
  e2eeVersion: number;
  /** Text sends only: where the message goes. */
  endpoint?: string;
  outcome: NativeOutcome;
  serverId?: string;
  createdTimeMs?: number;
  code: string;
  reason: string;
  /** File sends only: the object id and expiry of the upload. */
  oid?: string;
  expiresAt?: string;
}

/**
 * Result of line_scan_tokens: the access-token
 * candidates found in LINE's process memory. On failure tokens is
 * empty and code/reason carry a line error (LINE_NOT_RUNNING, MEMORY_READ_FAILED, TOKEN_NOT_FOUND).
 * A token is a secret: never log or persist it; it only ever flows into an outgoing request.
 */
export interface NativeTokensResult {
  tokens: string[];
  code?: string;
  reason?: string;
}
