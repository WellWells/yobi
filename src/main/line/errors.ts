/** Structured error codes for the LINE reader, surfaced to tool callers as JSON. */
export type LineErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'LINE_NOT_RUNNING'
  | 'MEMORY_READ_FAILED'
  | 'KEY_SCAN_EMPTY'
  | 'NO_KEY_DECRYPTED'
  | 'DB_NOT_FOUND'
  | 'DB_ACCESS'
  | 'DB_LOCKED';

export class LineError extends Error {
  constructor(
    readonly code: LineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LineError';
  }
}

export function isLineError(err: unknown): err is LineError {
  return err instanceof LineError;
}
