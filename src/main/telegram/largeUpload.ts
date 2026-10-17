import { TELEGRAM_UPLOAD_LIMIT_BYTES } from '../../shared/ytdl';

/**
 * Files over the Bot API's upload limit go up over MTProto as the same bot and come back as a
 * Bot API file_id, which the usual send calls take at any size. The MTProto side registers itself
 * here at start (setter injection), so the send path and the size limits never import it.
 */

/** Telegram's ceiling for one file a bot sends: 2000 MiB. */
export const TELEGRAM_LARGE_UPLOAD_MAX_BYTES = 2000 * 1024 * 1024;

export interface LargeUploadFile {
  /** Absolute local path, already checked by the caller. */
  path: string;
  kind: 'video' | 'audio' | 'photo' | 'document';
  video?: { width?: number; height?: number; duration?: number };
  audio?: { title?: string; performer?: string; duration?: number };
}

export interface LargeUploader {
  /** Whether the API id, API hash and bot token are all set. Cheap and synchronous. */
  configured(): boolean;
  /** Uploads the file as the bot, for `chatId`, and returns its Bot API file_id. */
  upload(chatId: string | number, file: LargeUploadFile, signal?: AbortSignal): Promise<string>;
}

let uploader: LargeUploader | null = null;

export function setLargeUploader(next: LargeUploader | null): void {
  uploader = next;
}

export function largeUploadReady(): boolean {
  return uploader?.configured() ?? false;
}

/** The largest single file a Telegram bot can send right now. */
export function telegramSendLimitBytes(): number {
  return largeUploadReady() ? TELEGRAM_LARGE_UPLOAD_MAX_BYTES : TELEGRAM_UPLOAD_LIMIT_BYTES;
}

export async function uploadLargeFile(chatId: string | number, file: LargeUploadFile, signal?: AbortSignal): Promise<string> {
  if (!uploader?.configured()) throw new Error('Large Telegram uploads are not set up');
  return uploader.upload(chatId, file, signal);
}
