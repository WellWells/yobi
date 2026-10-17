/**
 * What can go wrong uploading a big file as the bot over MTProto, as stable codes the user-facing
 * error path maps to words. Thrown messages are `TELEGRAM_UPLOAD:<code>[:<seconds>] <raw detail>`:
 * the raw detail is for the log only, `mtprotoErrorKey` reads nothing past the code.
 * No imports, so i18n.ts can read it without pulling in the MTProto client.
 */

export const MTPROTO_ERROR_PREFIX = 'TELEGRAM_UPLOAD:';

export const MTPROTO_ERROR_CODES = [
  'NOT_CONFIGURED',
  'NO_BOT_TOKEN',
  'API_ID_INVALID',
  'BOT_TOKEN_INVALID',
  'FLOOD_WAIT',
  'NETWORK',
  'CHAT_NOT_FOUND',
  'TOO_LARGE',
  'FAILED',
] as const;

export type MtprotoErrorCode = (typeof MTPROTO_ERROR_CODES)[number];

const ERROR_KEYS: Record<MtprotoErrorCode, string> = {
  NOT_CONFIGURED: 'main.error.telegramUploadNotConfigured',
  NO_BOT_TOKEN: 'main.error.telegramUploadNoBotToken',
  API_ID_INVALID: 'main.error.telegramUploadApiIdInvalid',
  BOT_TOKEN_INVALID: 'main.error.telegramUploadBotTokenInvalid',
  FLOOD_WAIT: 'main.error.telegramUploadFloodWait',
  NETWORK: 'main.error.telegramUploadNetwork',
  CHAT_NOT_FOUND: 'main.error.telegramUploadChatNotFound',
  TOO_LARGE: 'main.error.telegramUploadTooLarge',
  FAILED: 'main.error.telegramUploadFailed',
};

const API_ID_ERRORS = new Set(['API_ID_INVALID', 'API_ID_PUBLISHED_FLOOD', 'API_HASH_INVALID']);
const TOKEN_ERRORS = new Set(['ACCESS_TOKEN_INVALID', 'ACCESS_TOKEN_EXPIRED', 'BOT_TOKEN_INVALID', 'AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED']);
const PEER_ERRORS = new Set(['PEER_ID_INVALID', 'CHANNEL_INVALID', 'CHANNEL_PRIVATE', 'CHAT_ID_INVALID', 'USER_INVALID', 'CHAT_WRITE_FORBIDDEN', 'USER_IS_BLOCKED']);
const SIZE_ERRORS = new Set(['FILE_PARTS_INVALID', 'FILE_PART_TOO_BIG', 'FILE_PART_SIZE_INVALID', 'FILE_TOO_BIG']);
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE']);

export class MtprotoUploadError extends Error {
  constructor(readonly code: MtprotoErrorCode, detail: string, readonly seconds?: number) {
    super(`${MTPROTO_ERROR_PREFIX}${code}${seconds === undefined ? '' : `:${seconds}`} ${detail}`.trim());
    this.name = 'MtprotoUploadError';
  }
}

function rpcText(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const text = (err as { text?: unknown }).text;
  return typeof text === 'string' && typeof (err as { code?: unknown }).code === 'number' ? text : '';
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) return true;
  return /\b(?:timed? ?out|connection (?:closed|reset|refused)|socket hang up|network)\b/i.test(err.message);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Anything the MTProto client threw, as an error whose code the user-facing path can read. */
export function toMtprotoError(err: unknown): Error {
  if (err instanceof MtprotoUploadError || isAbortError(err)) return err as Error;
  const raw = err instanceof Error ? err.message : String(err);
  // A deadline the caller set (`AbortSignal.timeout`): Telegram did not answer in time.
  if (err instanceof Error && err.name === 'TimeoutError') return new MtprotoUploadError('NETWORK', raw);
  const text = rpcText(err);
  if (text === 'FLOOD_WAIT_%d' || /^FLOOD_(?:PREMIUM_)?WAIT/.test(text)) {
    const seconds = Number((err as { seconds?: unknown }).seconds);
    return new MtprotoUploadError('FLOOD_WAIT', raw, Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
  }
  if (API_ID_ERRORS.has(text)) return new MtprotoUploadError('API_ID_INVALID', raw);
  if (TOKEN_ERRORS.has(text)) return new MtprotoUploadError('BOT_TOKEN_INVALID', raw);
  if (PEER_ERRORS.has(text) || (err instanceof Error && err.name === 'MtPeerNotFoundError')) {
    return new MtprotoUploadError('CHAT_NOT_FOUND', raw);
  }
  if (SIZE_ERRORS.has(text) || /File is too large/.test(raw)) return new MtprotoUploadError('TOO_LARGE', raw);
  if (!text && isNetworkError(err)) return new MtprotoUploadError('NETWORK', raw);
  return new MtprotoUploadError('FAILED', text ? `${text}: ${raw}` : raw);
}

/** The language key (and its variables) for a raw message this module produced, or null. */
export function mtprotoErrorKey(raw: string): { key: string; vars?: Record<string, string> } | null {
  if (!raw.startsWith(MTPROTO_ERROR_PREFIX)) return null;
  const match = /^([A-Z_]+)(?::(\d+))?/.exec(raw.slice(MTPROTO_ERROR_PREFIX.length));
  const code = match?.[1] as MtprotoErrorCode | undefined;
  if (!code || !(code in ERROR_KEYS)) return null;
  if (code === 'FLOOD_WAIT') return { key: ERROR_KEYS[code], vars: { seconds: match?.[2] ?? '60' } };
  return { key: ERROR_KEYS[code] };
}
