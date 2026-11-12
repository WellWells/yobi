/**
 * One message's picture or file, fetched for a bot request (the LINE PC bot's intake): only a
 * message of the chat the request came from, checked before anything is fetched (with an id the
 * download SQL itself looks in every chat), saved under the name and in the folder the caller gives
 * — not Downloads/Yobi, and nothing noted for its cleanup — and no bigger than the caller allows.
 * The token candidates are the caller's (the bot keeps the ones its sends use), so no memory scan
 * runs per picture.
 */
import { LineError } from './errors';
import { runDownload, type DownloadDeps } from './lineDownload';
import type { DownloadResult } from './lineMediaRows';
import { targetMessage } from './lineSendReply';
import type { LineReader } from './reader';

export interface MessageDownloadRequest {
  /** The chat the message must be in. */
  chatId: string;
  /** The message, by LINE's id. */
  id: string;
  /** Where it is saved. */
  dir: string;
  /** Its name there (the caller's safe name, never the sender's). */
  fileName: string;
  maxBytes: number;
  tokens: () => Promise<string[]>;
}

/** What the download needs of the native core and the clock; the rest comes with the request. */
export type MessageDownloadDeps = Omit<DownloadDeps, 'tokens' | 'dir' | 'record' | 'maxBytes' | 'fileName'>;

export async function downloadChatMessage(reader: LineReader, req: MessageDownloadRequest, deps: MessageDownloadDeps): Promise<DownloadResult> {
  targetMessage(reader, req.chatId, req.id, 'id', 'downloaded');
  const [result] = await runDownload(reader.mediaSource(), { chat: '', id: req.id, sinceTs: 0, untilTs: 0, limit: 1, media: true }, {
    ...deps,
    tokens: req.tokens,
    dir: req.dir,
    record: async () => {},
    maxBytes: req.maxBytes,
    fileName: () => req.fileName,
  });
  if (!result) throw new LineError('INVALID_ARGUMENT', `no message with id: ${req.id}`);
  return result;
}
