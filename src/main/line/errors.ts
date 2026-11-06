/**
 * Structured error codes for the LINE reader, surfaced to tool callers as JSON. The set mirrors
 * line-cli's error codes so a caller reads the same codes from either tool. The reader/send
 * layers never put the DB key, the access token or driver text into an error's message.
 */
export type LineErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'LINE_NOT_RUNNING'
  | 'MEMORY_READ_FAILED'
  | 'KEY_SCAN_EMPTY'
  | 'NO_KEY_DECRYPTED'
  | 'DB_NOT_FOUND'
  | 'DB_ACCESS'
  | 'DB_LOCKED'
  | 'DB_UNREADABLE'
  // Chat / sender resolution (candidates travel in the thrown error, see LineAmbiguousError).
  | 'CHAT_NOT_FOUND'
  | 'CHAT_AMBIGUOUS'
  | 'SENDER_NOT_FOUND'
  | 'SENDER_AMBIGUOUS'
  | 'INVALID_ARGUMENT'
  // send / download (online, Letter Sealing).
  | 'TOKEN_NOT_FOUND'
  | 'E2EE_KEY_MISSING'
  | 'E2EE_DISABLED'
  | 'SEND_FAILED'
  | 'SEND_UNCERTAIN'
  | 'DUPLICATE_SEND'
  // The in-process native send core (via koffi) could not be loaded.
  | 'NATIVE_CORE_UNAVAILABLE';

export class LineError extends Error {
  /**
   * `candidates` is what the error body lists under "candidates": the
   * chats of a CHAT_AMBIGUOUS, the people of a SENDER_AMBIGUOUS; omitted when empty.
   */
  constructor(
    readonly code: LineErrorCode,
    message: string,
    readonly candidates?: readonly unknown[],
  ) {
    super(message);
    this.name = 'LineError';
  }
}

export function isLineError(err: unknown): err is LineError {
  return err instanceof LineError;
}
