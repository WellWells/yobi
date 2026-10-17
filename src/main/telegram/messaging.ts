import * as fs from 'node:fs/promises';
import { InputFile, InputMediaBuilder } from 'grammy';
import type { TelegramReplyMode, TelegramReplyTarget } from '../../shared/types';
import { resolveSafeLocalAttachment } from '../attachmentGuard';
import { getLangCache, t } from '../i18n';
import { getErrorMessage } from './errors';
import {
  escapeTelegramHtml,
  extractResponseSection,
  formatResponseForTelegramHtml,
  splitMarkdownIntoChunks,
  telegramVerbatimMessage,
  telegramVisibleLength,
  truncateText,
} from './formatter';
import { TELEGRAM_MESSAGE_MAX } from '../../shared/botMessageLimits';
import type { BotBuiltinRunResult } from '../botBuiltinCommands';
import { buildExportCallbackData, type ExportTokenRegistry } from './exporter';
import { fetchOptimizedImage } from './remoteImage';
import { flowButtonKeyboard } from './flowButtons';
import type { BotSendExtras, TelegramSendAs } from '../flow/types';
import { probeMedia } from '../youtubeDownload';
import type { MediaProbe } from '../youtubeDownload';
import { TELEGRAM_ALBUM_MAX, TELEGRAM_UPLOAD_LIMIT_BYTES } from '../../shared/ytdl';
import { largeUploadReady, uploadLargeFile } from './largeUpload';
import type { LargeUploadFile } from './largeUpload';
import { TELEGRAM_LARGE_UPLOAD_FAILED, TELEGRAM_LARGE_UPLOAD_NOT_READY } from './largeUploadError';
import { MTPROTO_ERROR_PREFIX } from './mtproto/errors';
import {
  safeSendMessage,
  sendDirectExport,
  type TelegramSendContext,
} from './exportHandlers';

const TELEGRAM_MSG_LIMIT = TELEGRAM_MESSAGE_MAX;
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_RESULT_MAX = 2600;
const COMPACT_CHUNK_CHARS = 3000;
const COMPACT_MAX_MESSAGES = 3;

export interface TelegramMessagingContext extends TelegramSendContext {
  isPollerActive: () => boolean;
  getDefaultReplyMode: () => TelegramReplyMode;
  getCompactReply: () => boolean;
  registry: ExportTokenRegistry;
}

export interface TelegramTaskSuccessPayload {
  providerLabel: string;
  savedFileName: string;
  response: string;
  prompt: string;
  title: string;
  elapsedSeconds: string;
}

/** `reply_markup` for a flow step's buttons, minted for this chat. */
function replyMarkupFor(chatId: number, extras?: BotSendExtras): { reply_markup?: ReturnType<typeof flowButtonKeyboard> } {
  const buttons = extras?.buttons;
  if (!buttons || buttons.items.length === 0) return {};
  return { reply_markup: flowButtonKeyboard(buttons.items, { flowId: buttons.flowId, chatId, userId: buttons.userId }) };
}

export async function sendProactive(
  mctx: TelegramMessagingContext,
  chatId: number,
  text: string,
  extras?: BotSendExtras,
): Promise<void> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive()) {
    throw new Error('Telegram bot is not running');
  }
  try {
    const s = mctx.getStrings();
    const responseSection = extractResponseSection(text, s);
    const responseText = truncateText(responseSection.trim(), TELEGRAM_RESULT_MAX);
    const body = formatResponseForTelegramHtml(responseText);
    const fallbackBody = `<i>${escapeTelegramHtml(t(s, 'telegram.msg.emptyResponse'))}</i>`;
    const message = body || fallbackBody;
    const markup = replyMarkupFor(chatId, extras);

    if (message.length > TELEGRAM_MSG_LIMIT) {
      const buffer = Buffer.from(responseSection || text, 'utf8');
      await bot.api.sendDocument(chatId, new InputFile(buffer, 'output.md'), {
        caption: t(getLangCache(), 'telegram.flowOutputTooLong', {}),
        ...markup,
      });
    } else {
      await bot.api.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...markup,
      });
    }
  } catch (err: unknown) {
    mctx.onLog(`[telegram] sendProactive failed for chat ${chatId}: ${String(err)}`);
    throw err;
  }
}

async function fileLooksLikeImage(resolvedPath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(resolvedPath, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    if (bytesRead < 4) return false;
    const ascii = (start: number, end: number): string => buf.toString('ascii', start, end);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return true;
    if (ascii(0, 4) === 'GIF8') return true;
    if (ascii(0, 2) === 'BM') return true;
    if (ascii(0, 2) === 'II' && buf[2] === 0x2a && buf[3] === 0x00) return true;
    if (ascii(0, 2) === 'MM' && buf[2] === 0x00 && buf[3] === 0x2a) return true;
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return true;
    if (bytesRead >= 12) {
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true;
      if (ascii(4, 8) === 'ftyp') {
        const brand = ascii(8, 12);
        if (['avif', 'avis', 'heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Files Telegram's music player takes (`sendAudio`); anything else goes as a document. */
const AUDIO_FILE_RE = /\.(?:mp3|m4a)$/i;

/** What Telegram's player shows for a sound file: its own title and artist tags, and its length. */
interface AudioMeta {
  title?: string;
  performer?: string;
  duration?: number;
}

function audioMeta(probe: MediaProbe | null): AudioMeta {
  return {
    ...(probe?.title ? { title: probe.title } : {}),
    ...(probe?.artist ? { performer: probe.artist } : {}),
    ...(probe?.durationSec ? { duration: Math.round(probe.durationSec) } : {}),
  };
}

/** Width, height and length of a video, for Telegram to size its player before it has the file. */
interface VideoMeta {
  width?: number;
  height?: number;
  duration?: number;
}

function videoMeta(probe: MediaProbe | null): VideoMeta {
  return {
    ...(probe?.width ? { width: probe.width } : {}),
    ...(probe?.height ? { height: probe.height } : {}),
    ...(probe?.durationSec ? { duration: Math.round(probe.durationSec) } : {}),
  };
}

/**
 * A local file over the Bot API's upload limit, uploaded over MTProto as the bot (`largeUpload.ts`)
 * for its Bot API file_id, which the usual send calls take at any size. Never tried while large
 * uploads are not set up; a failed upload is logged as it came and thrown in words
 * `localizeUserFacingError` knows.
 */
async function largeFileId(mctx: TelegramMessagingContext, chatId: number, file: LargeUploadFile): Promise<string> {
  if (!largeUploadReady()) throw new Error(TELEGRAM_LARGE_UPLOAD_NOT_READY);
  try {
    return await uploadLargeFile(chatId, file);
  } catch (err: unknown) {
    mctx.onLog(`[telegram] large upload of ${file.path} failed: ${String(err)}`);
    // The uploader's own coded errors (bad API id, flood wait…) already say what to fix.
    if (err instanceof Error && err.message.startsWith(MTPROTO_ERROR_PREFIX)) throw err;
    throw new Error(TELEGRAM_LARGE_UPLOAD_FAILED);
  }
}

/** Over what one Bot API upload takes (the request, not just the file). */
function overUploadLimit(sizeBytes: number): boolean {
  return sizeBytes > TELEGRAM_UPLOAD_LIMIT_BYTES;
}

type CaptionedOpts = { caption?: string; parse_mode?: 'HTML'; reply_markup?: ReturnType<typeof flowButtonKeyboard> };

/**
 * `sendProactiveFile` for a local file over the upload limit: the same choice of video, audio or
 * document (a photo that large goes as a document), sent by the file_id the large upload gave.
 */
async function sendLargeFile(
  mctx: TelegramMessagingContext,
  bot: TelegramBot,
  chatId: number,
  file: string,
  sendAs: TelegramSendAs,
  opts: CaptionedOpts,
): Promise<void> {
  if (sendAs === 'video' && /\.mp4$/i.test(file)) {
    const video = videoMeta(await probeMedia(file).catch(() => null));
    const fileId = await largeFileId(mctx, chatId, { path: file, kind: 'video', video });
    await bot.api.sendVideo(chatId, fileId, { ...opts, supports_streaming: true, ...video });
    return;
  }
  if (sendAs === 'audio' && AUDIO_FILE_RE.test(file)) {
    const audio = audioMeta(await probeMedia(file).catch(() => null));
    const fileId = await largeFileId(mctx, chatId, { path: file, kind: 'audio', audio });
    await bot.api.sendAudio(chatId, fileId, { ...opts, ...audio });
    return;
  }
  const fileId = await largeFileId(mctx, chatId, { path: file, kind: 'document' });
  await bot.api.sendDocument(chatId, fileId, opts);
}

export async function sendProactiveFile(
  mctx: TelegramMessagingContext,
  chatId: number,
  filePath: string,
  sendAs: TelegramSendAs,
  caption?: string,
  authorizedPaths?: string[],
  extras?: BotSendExtras,
): Promise<void> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive()) {
    throw new Error('Telegram bot is not running');
  }
  const captionSource = caption ? extractResponseSection(caption, mctx.getStrings()) : '';
  let captionHtml = captionSource ? formatResponseForTelegramHtml(captionSource) : '';
  if (captionHtml && telegramVisibleLength(captionHtml) > TELEGRAM_CAPTION_LIMIT) {
    captionHtml = formatResponseForTelegramHtml(truncateText(captionSource, TELEGRAM_CAPTION_LIMIT));
  }
  const captionOpts = {
    ...(captionHtml ? { caption: captionHtml, parse_mode: 'HTML' as const } : {}),
    ...replyMarkupFor(chatId, extras),
  };
  try {
    const isRemote = /^https?:\/\//i.test(filePath);
    const resolvedLocal = isRemote ? '' : await resolveSafeLocalAttachment(filePath, authorizedPaths);
    const media = (): string | InputFile => (isRemote ? filePath : new InputFile(resolvedLocal));

    // A file stat cannot read is sent the usual way and fails there, in Telegram's words.
    if (!isRemote && overUploadLimit(await fs.stat(resolvedLocal).then((s) => s.size, () => 0))) {
      await sendLargeFile(mctx, bot, chatId, resolvedLocal, sendAs, captionOpts);
      return;
    }

    if (sendAs === 'video' && !isRemote && /\.mp4$/i.test(resolvedLocal)) {
      // Width, height and length let Telegram size the player before it has the file; without
      // them it guesses, and a portrait Short shows up letterboxed.
      const probe = await probeMedia(resolvedLocal).catch(() => null);
      await bot.api.sendVideo(chatId, media(), { ...captionOpts, supports_streaming: true, ...videoMeta(probe) });
      return;
    }

    if (sendAs === 'audio' && !isRemote && AUDIO_FILE_RE.test(resolvedLocal)) {
      // Without a title and an artist Telegram's player shows the file name; an MP3 Yobi made
      // carries the video's title and channel (`--embed-metadata`).
      const probe = await probeMedia(resolvedLocal).catch(() => null);
      await bot.api.sendAudio(chatId, media(), { ...captionOpts, ...audioMeta(probe) });
      return;
    }

    let mode: 'photo' | 'document' = sendAs === 'auto' ? 'photo' : sendAs === 'video' || sendAs === 'audio' ? 'document' : sendAs;
    if (sendAs === 'auto' && !isRemote) {
      mode = (await fileLooksLikeImage(resolvedLocal)) ? 'photo' : 'document';
    }

    if (isRemote && mode === 'photo') {
      const optimized = await fetchOptimizedImage(filePath, mctx.onLog);
      if (optimized) {
        await bot.api.sendPhoto(chatId, new InputFile(optimized, 'image.jpg'), captionOpts);
        return;
      }
      mctx.onLog('[telegram] optimized image upload unavailable; falling back to URL send');
    }

    try {
      if (mode === 'photo') {
        await bot.api.sendPhoto(chatId, media(), captionOpts);
      } else {
        await bot.api.sendDocument(chatId, media(), captionOpts);
      }
    } catch (sendErr: unknown) {
      if (sendAs === 'auto' && mode === 'photo') {
        mctx.onLog(`[telegram] photo send failed, retrying as document: ${String(sendErr)}`);
        await bot.api.sendDocument(chatId, media(), captionOpts);
      } else {
        throw sendErr;
      }
    }
  } catch (err: unknown) {
    mctx.onLog(`[telegram] sendProactiveFile failed for chat ${chatId}: ${String(err)}`);
    throw err;
  }
}

/** Telegram would not take an image as a photo (its dimensions, or it could not process it). */
function isPhotoRefused(err: unknown): boolean {
  return /PHOTO_[A-Z_]+|IMAGE_PROCESS_FAILED/.test(String(err));
}

/** Telegram refused the request body as too large: its upload cap is per request, so an album's files count together. */
function isTooLargeError(err: unknown): boolean {
  return /\b413\b|too large/i.test(String(err));
}

type TelegramBot = NonNullable<ReturnType<TelegramMessagingContext['getBot']>>;
type CaptionOpts = { caption?: string; parse_mode?: 'HTML' };

interface AlbumFile {
  path: string;
  sizeBytes: number;
  kind: 'video' | 'photo' | 'audio' | 'document';
  /** Width, height and length of a video. */
  video?: VideoMeta;
  /** Title, artist and length of a sound file. */
  audio?: AudioMeta;
}

/** One album file sent alone by its file_id: what is left when the album of them cannot be made. */
async function sendByFileId(bot: TelegramBot, chatId: number, file: AlbumFile, fileId: string, opts: CaptionOpts): Promise<void> {
  if (file.kind === 'video') await bot.api.sendVideo(chatId, fileId, { ...opts, supports_streaming: true, ...file.video });
  else if (file.kind === 'audio') await bot.api.sendAudio(chatId, fileId, { ...opts, ...file.audio });
  else if (file.kind === 'photo') await bot.api.sendPhoto(chatId, fileId, opts);
  else await bot.api.sendDocument(chatId, fileId, opts);
}

function albumMedia(group: readonly AlbumFile[], media: ReadonlyArray<string | InputFile>, caption: CaptionOpts) {
  return group.map((file, index) => {
    const captioned = index === 0 ? caption : {};
    if (file.kind === 'video') return InputMediaBuilder.video(media[index], { ...captioned, supports_streaming: true, ...file.video });
    if (file.kind === 'photo') return InputMediaBuilder.photo(media[index], captioned);
    if (file.kind === 'audio') return InputMediaBuilder.audio(media[index], { ...captioned, ...file.audio });
    return InputMediaBuilder.document(media[index], captioned);
  }) as Array<ReturnType<typeof InputMediaBuilder.video>>;
}

const ALBUM_PHOTO_RE = /\.(?:jpe?g|png)$/i;
const ALBUM_VIDEO_RE = /\.mp4$/i;

/**
 * A sound file in an album: its tags and length, and when the album holds several, which one it
 * is (a post's videos as MP3s all carry the post's first line as their title).
 */
async function albumAudio(file: string, index: number, total: number): Promise<AudioMeta> {
  const meta = audioMeta(await probeMedia(file).catch(() => null));
  if (total < 2 || !meta.title) return meta;
  return { ...meta, title: `${meta.title} (${index + 1}/${total})` };
}

/**
 * An album over the upload cap cannot go up in one request,
 * but one made of files already on Telegram's servers costs nothing to send. So each file goes up
 * on its own — silently as a single message, or over MTProto when it alone is over the limit
 * (`largeFileId`, no message) — then the album is sent by file id and the single messages are
 * deleted. If the album cannot be made, the single messages stay and the large files are sent on
 * their own by file id: the files still arrive, caption and all.
 */
async function sendAlbumByFileId(
  mctx: TelegramMessagingContext,
  bot: TelegramBot,
  chatId: number,
  group: readonly AlbumFile[],
  caption: CaptionOpts,
): Promise<void> {
  const staged: Array<{ messageId: number | null; fileId: string | undefined }> = [];
  for (const [index, file] of group.entries()) {
    if (overUploadLimit(file.sizeBytes)) {
      const fileId = await largeFileId(mctx, chatId, { path: file.path, kind: file.kind, video: file.video, audio: file.audio });
      staged.push({ messageId: null, fileId });
      continue;
    }
    const opts = { ...(index === 0 ? caption : {}), disable_notification: true };
    const upload = new InputFile(file.path);
    let fileId: string | undefined;
    let messageId: number;
    if (file.kind === 'video') {
      const message = await bot.api.sendVideo(chatId, upload, { ...opts, supports_streaming: true, ...file.video });
      fileId = message.video?.file_id;
      messageId = message.message_id;
    } else if (file.kind === 'audio') {
      const message = await bot.api.sendAudio(chatId, upload, { ...opts, ...file.audio });
      fileId = message.audio?.file_id;
      messageId = message.message_id;
    } else if (file.kind === 'photo') {
      const message = await bot.api.sendPhoto(chatId, upload, opts);
      // Telegram keeps several sizes; the last is the largest.
      fileId = message.photo?.at(-1)?.file_id;
      messageId = message.message_id;
    } else {
      const message = await bot.api.sendDocument(chatId, upload, opts);
      fileId = message.document?.file_id;
      messageId = message.message_id;
    }
    staged.push({ messageId, fileId });
  }
  // The large files have no message of their own yet: alone by file id, the first with the
  // caption when no single message carries it already.
  const sendLargeAlone = async (): Promise<void> => {
    for (const [index, entry] of staged.entries()) {
      if (entry.messageId !== null || !entry.fileId) continue;
      await sendByFileId(bot, chatId, group[index], entry.fileId, index === 0 ? caption : {});
    }
  };
  const fileIds = staged.map((entry) => entry.fileId);
  if (!fileIds.every((id): id is string => Boolean(id))) {
    mctx.onLog('[telegram] a file did not come back as the expected media; leaving the files as separate messages');
    await sendLargeAlone();
    return;
  }
  try {
    await bot.api.sendMediaGroup(chatId, albumMedia(group, fileIds, caption));
  } catch (err: unknown) {
    mctx.onLog(`[telegram] album of uploaded files failed (${String(err)}); leaving them as separate messages`);
    await sendLargeAlone();
    return;
  }
  const singles = staged.flatMap((entry) => (entry.messageId === null ? [] : [entry.messageId]));
  if (singles.length === 0) return;
  await bot.api.deleteMessages(chatId, singles).catch((err: unknown) => {
    mctx.onLog(`[telegram] could not delete the single messages behind the album: ${String(err)}`);
  });
}

/**
 * Several local files as one album (Telegram's limit is 10 per album; more go as further albums),
 * the caption under the first. MP4s go as videos with their size and length and JPEG/PNGs as
 * photos — Telegram mixes those two. An album of MP3/M4As only (a post's videos as MP3s) goes as
 * audio, which mixes with nothing else; any other mix is sent as documents, since documents mix
 * with nothing. An album within the upload cap goes up in one request; a larger one by file id
 * (`sendAlbumByFileId`, which takes each file over the cap up over MTProto).
 */
export async function sendProactiveAlbum(
  mctx: TelegramMessagingContext,
  chatId: number,
  filePaths: readonly string[],
  caption?: string,
  authorizedPaths?: string[],
): Promise<void> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive()) {
    throw new Error('Telegram bot is not running');
  }
  const captionSource = caption ? extractResponseSection(caption, mctx.getStrings()) : '';
  let captionHtml = captionSource ? formatResponseForTelegramHtml(captionSource) : '';
  if (captionHtml && telegramVisibleLength(captionHtml) > TELEGRAM_CAPTION_LIMIT) {
    captionHtml = formatResponseForTelegramHtml(truncateText(captionSource, TELEGRAM_CAPTION_LIMIT));
  }
  const captionOpts: CaptionOpts = captionHtml ? { caption: captionHtml, parse_mode: 'HTML' } : {};
  const paths = await Promise.all(filePaths.map((p) => resolveSafeLocalAttachment(p, authorizedPaths)));
  const asMedia = paths.every((file) => ALBUM_VIDEO_RE.test(file) || ALBUM_PHOTO_RE.test(file));
  const asAudio = paths.every((file) => AUDIO_FILE_RE.test(file));
  const files: AlbumFile[] = await Promise.all(paths.map(async (file, index): Promise<AlbumFile> => {
    const sizeBytes = (await fs.stat(file)).size;
    if (asAudio) return { path: file, sizeBytes, kind: 'audio', audio: await albumAudio(file, index, paths.length) };
    if (!asMedia) return { path: file, sizeBytes, kind: 'document' };
    if (ALBUM_PHOTO_RE.test(file)) return { path: file, sizeBytes, kind: 'photo' };
    return { path: file, sizeBytes, kind: 'video', video: videoMeta(await probeMedia(file).catch(() => null)) };
  }));
  try {
    for (let start = 0; start < files.length; start += TELEGRAM_ALBUM_MAX) {
      const group = files.slice(start, start + TELEGRAM_ALBUM_MAX);
      const groupCaption = start === 0 ? captionOpts : {};
      if (group.length === 1) {
        // `auto` for a photo: it falls back to a document when Telegram refuses the photo.
        const sendAs = group[0].kind === 'photo' ? 'auto' : group[0].kind;
        await sendProactiveFile(mctx, chatId, group[0].path, sendAs, start === 0 ? caption : undefined, authorizedPaths);
        continue;
      }
      const totalBytes = group.reduce((sum, file) => sum + file.sizeBytes, 0);
      if (totalBytes > TELEGRAM_UPLOAD_LIMIT_BYTES) {
        await sendAlbumByFileId(mctx, bot, chatId, group, groupCaption);
        continue;
      }
      try {
        await bot.api.sendMediaGroup(chatId, albumMedia(group, group.map((file) => new InputFile(file.path)), groupCaption));
      } catch (err: unknown) {
        if (isPhotoRefused(err) && group.some((file) => file.kind === 'photo')) {
          // A tall capture is past a photo's size rules; as documents the same files go through.
          mctx.onLog(`[telegram] album photos refused (${String(err)}); sending the album as documents`);
          const asDocuments = group.map((file): AlbumFile => ({ path: file.path, sizeBytes: file.sizeBytes, kind: 'document' }));
          await bot.api.sendMediaGroup(chatId, albumMedia(asDocuments, asDocuments.map((file) => new InputFile(file.path)), groupCaption));
          continue;
        }
        if (!isTooLargeError(err)) throw err;
        mctx.onLog(`[telegram] album refused as too large; uploading its ${group.length} files one at a time`);
        await sendAlbumByFileId(mctx, bot, chatId, group, groupCaption);
      }
    }
  } catch (err: unknown) {
    mctx.onLog(`[telegram] sendProactiveAlbum failed for chat ${chatId}: ${String(err)}`);
    throw err;
  }
}

function commandLabel(s: Record<string, string>, command: string): string {
  return command === 'direct' ? t(s, 'telegram.msg.directLabel') : command;
}

export async function sendTaskSuccess(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  payload: TelegramTaskSuccessPayload,
): Promise<void> {
  if (!mctx.getBot() || !mctx.isPollerActive()) return;
  const s = mctx.getStrings();
  const responseSection = extractResponseSection(payload.response, s);

  if (mctx.getCompactReply()) {
    await sendCompactReply(mctx, target, responseSection);
    await deleteQueuedMessage(mctx, target);
    return;
  }

  const responseText = truncateText(responseSection.trim(), TELEGRAM_RESULT_MAX);
  const body = formatResponseForTelegramHtml(responseText);
  const defaultReplyMode = mctx.getDefaultReplyMode();
  const titleLine = escapeTelegramHtml(
    t(s, 'telegram.msg.completed', {
      command: commandLabel(s, target.command),
      provider: payload.providerLabel,
      elapsed: payload.elapsedSeconds,
    }),
  );
  const savedLine = escapeTelegramHtml(
    t(s, 'telegram.msg.saved', { file: payload.savedFileName }),
  );
  if (defaultReplyMode === 'markdown') {
    const exportToken = mctx.registry.issue({
      command: target.command,
      chatId: target.chatId,
      userId: target.userId,
      providerLabel: payload.providerLabel,
      savedFileName: payload.savedFileName,
      prompt: payload.prompt,
      response: payload.response,
      title: payload.title,
    });
    const message = [
      titleLine,
      savedLine,
      '',
      body || `<i>${escapeTelegramHtml(t(s, 'telegram.msg.emptyResponse'))}</i>`,
    ].join('\n');
    const keyboard = {
      inline_keyboard: [
        [
          { text: t(s, 'telegram.msg.downloadPng'), callback_data: buildExportCallbackData(exportToken, 'png') },
          { text: t(s, 'telegram.msg.downloadWebp'), callback_data: buildExportCallbackData(exportToken, 'webp') },
        ],
        [
          { text: t(s, 'telegram.msg.downloadPdf'), callback_data: buildExportCallbackData(exportToken, 'pdf') },
        ],
      ],
    };
    await safeSendMessage(mctx, target.chatId, message, target.requestMessageId, keyboard);
    await deleteQueuedMessage(mctx, target);
    return;
  }

  await sendDirectExport(mctx, {
    command: target.command,
    chatId: target.chatId,
    userId: target.userId,
    providerLabel: payload.providerLabel,
    savedFileName: payload.savedFileName,
    prompt: payload.prompt,
    response: payload.response,
    title: payload.title,
    format: defaultReplyMode,
    replyToMessageId: target.requestMessageId,
  });
  await deleteQueuedMessage(mctx, target);
}

/**
 * A bot run's reply. A question marked `verbatim` (a shell approval) goes out as plain text exactly
 * as written, whatever the reply mode: compact, Markdown, PNG, WebP and PDF all rewrite, cut or
 * picture the text, and the user must read the whole command that "1" would run. Returns false
 * when such a question could not be shown whole; the caller then withdraws it.
 */
export async function sendBuiltinReply(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  prompt: string,
  result: BotBuiltinRunResult,
): Promise<boolean> {
  if (!result.ok) {
    await sendTaskError(mctx, target, { providerLabel: result.providerLabel, message: result.text });
    return true;
  }
  if (result.verbatim) return sendVerbatimReply(mctx, target, result);
  await sendTaskSuccess(mctx, target, {
    providerLabel: result.providerLabel,
    savedFileName: result.savedFileName,
    response: result.text,
    prompt,
    title: result.title,
    elapsedSeconds: result.elapsedSeconds,
  });
  return true;
}

async function sendVerbatimReply(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  result: BotBuiltinRunResult,
): Promise<boolean> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive()) return false;
  const message = telegramVerbatimMessage(result.text);
  // Never clipped: a question too long to read whole is not sent at all.
  if (message.text.length > TELEGRAM_MSG_LIMIT) {
    mctx.onLog(`[telegram] a ${message.text.length}-character question does not fit one message — withdrawn`);
    await sendTaskError(mctx, target, { providerLabel: result.providerLabel, message: t(mctx.getStrings(), 'bot.builtin.failed') });
    return false;
  }
  try {
    await bot.api.sendMessage(target.chatId, message.text, {
      ...(message.entities.length > 0 ? { entities: message.entities } : {}),
      reply_parameters: target.requestMessageId ? { message_id: target.requestMessageId } : undefined,
      link_preview_options: { is_disabled: true },
    });
  } catch (err: unknown) {
    mctx.onLog(`[telegram] failed to send a question: ${getErrorMessage(err)}`);
    await deleteQueuedMessage(mctx, target);
    return false;
  }
  await deleteQueuedMessage(mctx, target);
  return true;
}

async function sendCompactReply(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  response: string,
): Promise<void> {
  const s = mctx.getStrings();
  const emptyBody = `<i>${escapeTelegramHtml(t(s, 'telegram.msg.emptyResponse'))}</i>`;
  const chunks = splitMarkdownIntoChunks(response, COMPACT_CHUNK_CHARS, COMPACT_MAX_MESSAGES);
  if (chunks.length === 0) {
    await safeSendMessage(mctx, target.chatId, emptyBody, target.requestMessageId);
    return;
  }
  for (const [index, chunk] of chunks.entries()) {
    const body = renderCompactChunk(chunk) || emptyBody;
    await safeSendMessage(mctx, target.chatId, body, index === 0 ? target.requestMessageId : undefined);
  }
}

function renderCompactChunk(chunk: string): string {
  let source = chunk;
  let html = formatResponseForTelegramHtml(source);
  while (html.length > TELEGRAM_MSG_LIMIT && source.length > 32) {
    const ratio = TELEGRAM_MSG_LIMIT / html.length;
    source = truncateText(source, Math.max(32, Math.floor(source.length * ratio) - 16));
    html = formatResponseForTelegramHtml(source);
  }
  return html;
}

export async function sendTaskError(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  payload: { providerLabel: string; message: string },
): Promise<void> {
  if (!mctx.getBot() || !mctx.isPollerActive()) return;
  const s = mctx.getStrings();
  const plainText = truncateText(
    t(s, 'telegram.msg.failed', {
      command: commandLabel(s, target.command),
      provider: payload.providerLabel,
    })+ '\n' + (payload.message || t(s, 'telegram.msg.unknownError')),
    TELEGRAM_MSG_LIMIT - 32,
  );
  const text = escapeTelegramHtml(plainText);
  await safeSendMessage(mctx, target.chatId, text, target.requestMessageId);
  await deleteQueuedMessage(mctx, target);
}

async function deleteQueuedMessage(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
): Promise<void> {
  const bot = mctx.getBot();
  if (!bot || !target.queuedMessageId) return;
  try {
    await bot.api.deleteMessage(target.chatId, target.queuedMessageId);
  } catch (err: unknown) {
    mctx.onLog(`[telegram] failed to delete queued message: ${getErrorMessage(err)}`);
  }
}
