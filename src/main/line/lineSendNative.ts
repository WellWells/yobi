/**
 * Requests to the native send core. Key material comes picked by readySendKeys, which stops on a
 * missing key or disabled sealing first, and is passed in the request only; it is never logged.
 */
import { LineError } from './errors';
import type { NativeClientEnv, NativeSendFileRequest, NativeSendRequest, NativeSendResult } from './nativeContract';
import { CONTENT_TEXT, readySendKeys, type NativeKeyPicker, type ReadyKeys } from './lineSendText';
import type { PreparedFile } from './lineSendFilePrep';
import type { LineReader } from './reader';

export type NativeSender = (req: NativeSendRequest) => Promise<NativeSendResult>;
export type NativeFileSender = (req: NativeSendFileRequest) => Promise<NativeSendResult>;

export interface NativeTextPlanInput {
  chatId: string;
  from: string;
  text: string;
  ready: ReadyKeys;
  clientId: string;
  createdTime: number;
  /** The id of the message replied to; '' for none. */
  relatedId?: string;
  /** The MENTION metadata value; '' for none. */
  mentionMeta?: string;
  randomSeedB64?: string;
  /** A real send (dryRun false) carries the access tokens and the client env for the native POST. */
  tokens?: string[];
  clientEnv?: NativeClientEnv;
}

/** Builds the native request for a text send. */
export function buildNativeTextRequest(input: NativeTextPlanInput): NativeSendRequest {
  const real = input.tokens !== undefined;
  const { version, keys } = input.ready;
  return {
    chatId: input.chatId,
    from: input.from,
    version,
    toType: version === 2 ? 2 : 0,
    contentType: CONTENT_TEXT,
    text: input.text,
    keys,
    clientId: input.clientId,
    createdTime: input.createdTime,
    ...(input.relatedId ? { relatedId: input.relatedId } : {}),
    ...(input.mentionMeta ? { mentionMeta: input.mentionMeta } : {}),
    ...(input.randomSeedB64 ? { randomSeedB64: input.randomSeedB64 } : {}),
    ...(real && input.clientEnv ? { clientEnv: input.clientEnv } : {}),
    tokens: input.tokens ?? [],
    dryRun: !real,
  };
}

/** Sends the text through the native core (POST, token iteration, reply classification). One call, never retried. */
export async function nativeTextSend(input: NativeTextPlanInput & { tokens: string[] }, send: NativeSender): Promise<NativeSendResult> {
  return send(buildNativeTextRequest(input));
}

/** Runs the text dry run through native and returns its plan vectors. */
export async function nativeTextDryRun(input: NativeTextPlanInput, send: NativeSender): Promise<NativeSendResult> {
  const res = await send(buildNativeTextRequest(input));
  if (res.outcome !== 'dryrun') {
    throw new LineError('SEND_FAILED', `native dry run failed: ${res.code || res.outcome}`);
  }
  return res;
}

export interface NativeFileInput {
  chatId: string;
  from: string;
  job: PreparedFile;
  clientId: string;
  createdTime: number;
  relatedId?: string;
  album?: { gid: string; seq: number; total: number };
  tokens: string[];
  clientEnv: NativeClientEnv;
}

/** Builds the native request for one file, with the keys of this moment (state checked first). */
export async function buildNativeFileRequest(reader: LineReader, pick: NativeKeyPicker | undefined, input: NativeFileInput): Promise<NativeSendFileRequest> {
  const { version, keys } = await readySendKeys(reader, input.chatId, pick);
  const f = input.job.file;
  return {
    chatId: input.chatId,
    from: input.from,
    toType: version === 2 ? 2 : 0,
    keys,
    clientId: input.clientId,
    createdTime: input.createdTime,
    ...(input.relatedId ? { relatedId: input.relatedId } : {}),
    clientEnv: input.clientEnv,
    tokens: input.tokens,
    file: {
      path: f.path,
      name: f.name,
      ext: input.job.ext,
      contentType: input.job.contentType,
      bytes: f.bytes,
      ...(input.job.preview ? { previewB64: input.job.preview.toString('base64') } : {}),
      ...(f.width ? { width: f.width } : {}),
      ...(f.height ? { height: f.height } : {}),
      ...(f.duration_ms ? { durationMs: f.duration_ms } : {}),
    },
    ...(input.album ? { album: input.album } : {}),
    dryRun: false,
  };
}
