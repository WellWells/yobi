import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { basename } from 'node:path';
import { InputMedia, MemoryStorage, MtPeerNotFoundError } from '@mtcute/core';
import type { InputMediaLike, InputPeerLike } from '@mtcute/core';
import { BaseTelegramClient } from '@mtcute/core/client.js';
import { resolvePeer, start, uploadMedia } from '@mtcute/core/methods.js';
import type { LargeUploadFile } from '../largeUpload';
import { untilAborted } from './abort';
import { MtprotoUploadError } from './errors';
import { createPlatform, createTransport, YobiCryptoProvider } from './platform';
import type { MtprotoClient, MtprotoCredentials } from './uploader';

/*
 * The one module that talks to mtcute. Loaded on the first big upload (a dynamic import), so the
 * MTProto library is never parsed on an ordinary start.
 *
 * Bot API chat ids are mtcute's "marked" ids, so they go to resolvePeer as numbers. A chat it
 * cannot resolve falls back to the bot itself (`inputPeerSelf`): the file_id belongs to the bot
 * either way.
 */

function buildMedia(stream: ReadStream, file: LargeUploadFile): InputMediaLike {
  const fileName = basename(file.path);
  switch (file.kind) {
    case 'video':
      return InputMedia.video(stream, {
        fileName,
        width: file.video?.width,
        height: file.video?.height,
        duration: file.video?.duration,
        supportsStreaming: true,
      });
    case 'audio':
      return InputMedia.audio(stream, {
        fileName,
        title: file.audio?.title,
        performer: file.audio?.performer,
        duration: file.audio?.duration,
      });
    case 'photo':
      return InputMedia.photo(stream, { fileName });
    default:
      return InputMedia.document(stream, { fileName });
  }
}

async function resolveUploadPeer(client: BaseTelegramClient, chatId: number): Promise<InputPeerLike> {
  if (!Number.isSafeInteger(chatId) || chatId === 0) {
    throw new MtprotoUploadError('CHAT_NOT_FOUND', `not a chat id: ${chatId}`);
  }
  try {
    return await resolvePeer(client, chatId);
  } catch (err: unknown) {
    if (!(err instanceof MtPeerNotFoundError)) throw err;
    client.log.warn('chat %d not resolvable by the bot, uploading for the bot itself', chatId);
    return { _: 'inputPeerSelf' };
  }
}

export async function openMtcuteClient(
  credentials: MtprotoCredentials,
  session: string | null,
  log: (message: string) => void,
): Promise<MtprotoClient> {
  const client = new BaseTelegramClient({
    apiId: credentials.apiId,
    apiHash: credentials.apiHash,
    storage: new MemoryStorage(),
    crypto: new YobiCryptoProvider(),
    transport: createTransport(),
    platform: createPlatform(log),
    // Yobi's Bot API polling owns the bot's updates; this session must never take them.
    disableUpdates: true,
    updates: false,
    initConnectionOptions: { appVersion: 'Yobi' },
  });
  if (session) await client.importSession(session, true);

  return {
    async signIn(signal) {
      const me = await untilAborted(start(client, { botToken: credentials.botToken, abortSignal: signal }), signal);
      return { id: me.id, username: me.username ?? '' };
    },
    async upload(chatId, file, signal) {
      signal?.throwIfAborted();
      const peer = await resolveUploadPeer(client, chatId);
      const stream = createReadStream(file.path);
      try {
        // `abortSignal` is not in uploadMedia's declared params, but it hands its params to the
        // file upload, which stops sending parts once the signal fires.
        const params: Parameters<typeof uploadMedia>[2] & { abortSignal?: AbortSignal } = { peer, abortSignal: signal };
        const media = await untilAborted(uploadMedia(client, buildMedia(stream, file), params), signal);
        signal?.throwIfAborted();
        return media.fileId;
      } finally {
        stream.destroy();
      }
    },
    exportSession: () => client.exportSession(),
    close: () => client.destroy(),
  };
}
