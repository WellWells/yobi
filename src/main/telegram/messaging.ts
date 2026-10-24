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
import type { AgentAskShown, BotBuiltinRunResult } from '../botBuiltinCommands';
import { numberedQuestion } from '../flow/agent/shellApproval';
import { buildExportCallbackData, type ExportTokenRegistry } from './exporter';
import { fetchOptimizedImage } from './remoteImage';
import { flowButtonKeyboard } from './flowButtons';
import { askKeyboard, clearRetiredButtons, noteAskMessage, retireAskButtons } from './askButtons';
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
  /** A run's question reached the chat: its message, and whether its choices were numbered. */
  onAgentAskShown?: (target: TelegramReplyTarget, shown: AgentAskShown) => void;
  /** The run whose question this person still has to answer in this chat, or null. */
  pendingAgentAskRunId?: (chatId: number, userId: number) => string | null;
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

type ReplyQuote = { reply_parameters?: { message_id: number; allow_sending_without_reply: true } };

/** Quotes the message a send answers (`BotSendExtras.replyTo`); it still goes out if that message is gone. */
function quoteOf(replyTo: number | undefined): ReplyQuote {
  return replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {};
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
    const markup = { ...replyMarkupFor(chatId, extras), ...quoteOf(extras?.replyTo) };

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

type CaptionedOpts = { caption?: string; parse_mode?: 'HTML'; reply_markup?: ReturnType<typeof flowButtonKeyboard> } & ReplyQuote;

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
    ...quoteOf(extras?.replyTo),
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
  quote: ReplyQuote = {},
): Promise<void> {
  const staged: Array<{ messageId: number | null; fileId: string | undefined }> = [];
  for (const [index, file] of group.entries()) {
    if (overUploadLimit(file.sizeBytes)) {
      const fileId = await largeFileId(mctx, chatId, { path: file.path, kind: file.kind, video: file.video, audio: file.audio });
      staged.push({ messageId: null, fileId });
      continue;
    }
    // The first carries the caption and the quote, for when it stays as a message of its own.
    const opts = { ...(index === 0 ? { ...caption, ...quote } : {}), disable_notification: true };
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
      await sendByFileId(bot, chatId, group[index], entry.fileId, index === 0 ? { ...caption, ...quote } : {});
    }
  };
  const fileIds = staged.map((entry) => entry.fileId);
  if (!fileIds.every((id): id is string => Boolean(id))) {
    mctx.onLog('[telegram] a file did not come back as the expected media; leaving the files as separate messages');
    await sendLargeAlone();
    return;
  }
  try {
    await bot.api.sendMediaGroup(chatId, albumMedia(group, fileIds, caption), quote);
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
  replyTo?: number,
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
  const quote = quoteOf(replyTo);
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
      // Only the first album quotes the asking message; the rest follow it.
      const groupQuote = start === 0 ? quote : {};
      if (group.length === 1) {
        // `auto` for a photo: it falls back to a document when Telegram refuses the photo.
        const sendAs = group[0].kind === 'photo' ? 'auto' : group[0].kind;
        const extras = start === 0 && replyTo ? { replyTo } : undefined;
        await sendProactiveFile(mctx, chatId, group[0].path, sendAs, start === 0 ? caption : undefined, authorizedPaths, extras);
        continue;
      }
      const totalBytes = group.reduce((sum, file) => sum + file.sizeBytes, 0);
      if (totalBytes > TELEGRAM_UPLOAD_LIMIT_BYTES) {
        await sendAlbumByFileId(mctx, bot, chatId, group, groupCaption, groupQuote);
        continue;
      }
      try {
        await bot.api.sendMediaGroup(chatId, albumMedia(group, group.map((file) => new InputFile(file.path)), groupCaption), groupQuote);
      } catch (err: unknown) {
        if (isPhotoRefused(err) && group.some((file) => file.kind === 'photo')) {
          // A tall capture is past a photo's size rules; as documents the same files go through.
          mctx.onLog(`[telegram] album photos refused (${String(err)}); sending the album as documents`);
          const asDocuments = group.map((file): AlbumFile => ({ path: file.path, sizeBytes: file.sizeBytes, kind: 'document' }));
          await bot.api.sendMediaGroup(chatId, albumMedia(asDocuments, asDocuments.map((file) => new InputFile(file.path)), groupCaption), groupQuote);
          continue;
        }
        if (!isTooLargeError(err)) throw err;
        mctx.onLog(`[telegram] album refused as too large; uploading its ${group.length} files one at a time`);
        await sendAlbumByFileId(mctx, bot, chatId, group, groupCaption, groupQuote);
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
 * Drawn pictures as the reply itself: a photo (several: an album) answering the request, the
 * caption under it (an album: under the first), no title, saved-file or export lines. Returns
 * false, having sent nothing, when the caption does not fit one or Telegram refuses the pictures;
 * the caller then sends the text and the pictures apart.
 */
export async function sendPictureReply(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  files: readonly string[],
  caption: string,
): Promise<boolean> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive() || files.length === 0 || files.length > TELEGRAM_ALBUM_MAX) return false;
  const captionSource = extractResponseSection(caption, mctx.getStrings()).trim();
  const captionHtml = captionSource ? formatResponseForTelegramHtml(captionSource) : '';
  if (telegramVisibleLength(captionHtml) > TELEGRAM_CAPTION_LIMIT) return false;
  const captionOpts: CaptionOpts = captionHtml ? { caption: captionHtml, parse_mode: 'HTML' } : {};
  const reply = target.requestMessageId
    ? { reply_parameters: { message_id: target.requestMessageId, allow_sending_without_reply: true } }
    : {};
  try {
    const paths = await Promise.all(files.map((file) => resolveSafeLocalAttachment(file, [...files])));
    if (paths.length === 1) {
      await bot.api.sendPhoto(target.chatId, new InputFile(paths[0]), { ...captionOpts, ...reply });
    } else {
      const media = paths.map((file, index) => InputMediaBuilder.photo(new InputFile(file), index === 0 ? captionOpts : {}));
      await bot.api.sendMediaGroup(target.chatId, media, reply);
    }
  } catch (err: unknown) {
    mctx.onLog(`[telegram] pictures not sent as the reply: ${getErrorMessage(err)}`);
    return false;
  }
  await deleteQueuedMessage(mctx, target);
  return true;
}

/**
 * The buttons of every question of this person's that no longer waits come off, before a reply that
 * puts up no question of its own: a request that ran and failed, or answered with pictures, dropped
 * the question too. One refused before it ran dropped nothing, so the waiting run's buttons stay.
 */
export async function clearStaleAskButtons(mctx: TelegramMessagingContext, target: TelegramReplyTarget): Promise<void> {
  if (!mctx.pendingAgentAskRunId) return;
  const waiting = mctx.pendingAgentAskRunId(target.chatId, target.userId) ?? undefined;
  await clearRetiredButtons(mctx.getBot()?.api, retireAskButtons(target.chatId, target.userId, waiting), mctx.getStrings());
}

/**
 * A bot run's reply. A question marked `verbatim` (a shell approval) goes out as plain text exactly
 * as written, whatever the reply mode: compact, Markdown, PNG, WebP and PDF all rewrite, cut or
 * picture the text, and the user must read the whole command that "1" would run. Returns false
 * when a question could not be shown (an approval: not whole); the caller then withdraws it.
 */
export async function sendBuiltinReply(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  prompt: string,
  result: BotBuiltinRunResult,
): Promise<boolean> {
  if (!result.ok) {
    await clearStaleAskButtons(mctx, target);
    await sendTaskError(mctx, target, { providerLabel: result.providerLabel, message: result.text });
    return true;
  }
  // Whatever ran (a new request, an answer, a newer question), the question this person had waiting
  // no longer is: its buttons come off rather than stay looking answerable.
  await clearRetiredButtons(mctx.getBot()?.api, retireAskButtons(target.chatId, target.userId), mctx.getStrings());
  if (result.question) return sendQuestionReply(mctx, target, result, result.question);
  if (result.verbatim) return sendVerbatimReply(mctx, target, result);
  if (result.awaitingAnswer) return sendPlainQuestion(mctx, target, result.text);
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

/**
 * A question with choices: its words, then one button per choice (`askButtons.ts`) in place of the
 * numbered list. Always one text message, whatever the reply mode — a question pictured as a PNG or
 * cut into chunks has nowhere to put the buttons. An approval is shown exactly as written, the
 * model's own question keeps its formatting. Typing an answer still works.
 */
async function sendQuestionReply(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  result: BotBuiltinRunResult,
  question: NonNullable<BotBuiltinRunResult['question']>,
): Promise<boolean> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive()) return false;
  const hint = t(mctx.getStrings(), 'telegram.ask.hint');
  const verbatim = result.verbatim ? telegramVerbatimMessage(`${question.text}\n\n${hint}`) : null;
  // Never clipped: an approval too long to read whole is not sent at all (as `sendVerbatimReply`).
  if (verbatim && verbatim.text.length > TELEGRAM_MSG_LIMIT) return sendVerbatimReply(mctx, target, result);
  const text = verbatim
    ? verbatim.text
    : `${formatResponseForTelegramHtml(truncateText(question.text.trim(), TELEGRAM_RESULT_MAX))}\n\n<i>${escapeTelegramHtml(hint)}</i>`;
  let messageId: number;
  try {
    const sent = await bot.api.sendMessage(target.chatId, text, {
      ...(verbatim ? (verbatim.entities.length > 0 ? { entities: verbatim.entities } : {}) : { parse_mode: 'HTML' as const }),
      reply_markup: askKeyboard({ runId: question.runId, chatId: target.chatId, userId: target.userId }, question.choices),
      reply_parameters: target.requestMessageId ? { message_id: target.requestMessageId } : undefined,
      link_preview_options: { is_disabled: true },
    });
    messageId = sent.message_id;
  } catch (err: unknown) {
    mctx.onLog(`[telegram] failed to send a question with buttons: ${getErrorMessage(err)}`);
    retireAskButtons(target.chatId, target.userId);
    if (verbatim) {
      await deleteQueuedMessage(mctx, target);
      return false;
    }
    return sendNumberedQuestion(mctx, target, question);
  }
  noteAskMessage(target.chatId, target.userId, messageId);
  // Buttons show no numbers, so a typed "1" is not a choice (and never an approval) here.
  mctx.onAgentAskShown?.(target, { messageId, numbered: false });
  await deleteQueuedMessage(mctx, target);
  return true;
}

/**
 * A question without choices: one message whatever the reply mode, as a question with buttons is,
 * so the message that carries it is known and only one sent after it answers (`sentAfterAsk`).
 * Through the reply mode its id was never kept, and Telegram's whole-second `date` was weighed
 * against this computer's clock: a message sent in the same second, before the question, answered
 * it (review 2026-10-20). HTML Telegram refuses is sent again as plain text.
 */
async function sendPlainQuestion(mctx: TelegramMessagingContext, target: TelegramReplyTarget, text: string): Promise<boolean> {
  const bot = mctx.getBot();
  if (!bot || !mctx.isPollerActive()) return false;
  const s = mctx.getStrings();
  const hint = t(s, 'bot.builtin.answerHint');
  const whole = extractResponseSection(text, s).trim();
  const question = truncateText((whole.endsWith(hint) ? whole.slice(0, -hint.length) : whole).trim(), TELEGRAM_RESULT_MAX);
  const quote = target.requestMessageId ? { reply_parameters: { message_id: target.requestMessageId, allow_sending_without_reply: true } } : {};
  const send = (body: string, html: boolean) => bot.api.sendMessage(target.chatId, body, {
    ...(html ? { parse_mode: 'HTML' as const } : {}),
    ...quote,
    link_preview_options: { is_disabled: true },
  });
  let messageId: number;
  try {
    messageId = (await send(`${formatResponseForTelegramHtml(question)}\n\n<i>${escapeTelegramHtml(hint)}</i>`, true)
      .catch(() => send(`${question}\n\n${hint}`, false))).message_id;
  } catch (err: unknown) {
    mctx.onLog(`[telegram] failed to send a question: ${getErrorMessage(err)}`);
    await deleteQueuedMessage(mctx, target);
    return false;
  }
  mctx.onAgentAskShown?.(target, { messageId, numbered: true });
  await deleteQueuedMessage(mctx, target);
  return true;
}

/**
 * The model's question when its buttons could not be sent: one plain-text message, the choices
 * numbered so a typed "2" answers — never through the reply mode (a card, compact chunks or export
 * buttons are no place for a question). Measured before it goes out, as the button message is.
 */
async function sendNumberedQuestion(
  mctx: TelegramMessagingContext,
  target: TelegramReplyTarget,
  question: NonNullable<BotBuiltinRunResult['question']>,
): Promise<boolean> {
  const bot = mctx.getBot();
  if (!bot) return false;
  const hint = t(mctx.getStrings(), 'bot.builtin.answerHint');
  const text = `${numberedQuestion(truncateText(question.text.trim(), TELEGRAM_RESULT_MAX), question.choices)}\n\n${hint}`;
  if (text.length > TELEGRAM_MSG_LIMIT) {
    mctx.onLog(`[telegram] a ${text.length}-character question does not fit one message — withdrawn`);
    await sendTaskError(mctx, target, { providerLabel: '', message: t(mctx.getStrings(), 'bot.builtin.failed') });
    return false;
  }
  try {
    const sent = await bot.api.sendMessage(target.chatId, text, {
      reply_parameters: target.requestMessageId ? { message_id: target.requestMessageId, allow_sending_without_reply: true } : undefined,
      link_preview_options: { is_disabled: true },
    });
    mctx.onAgentAskShown?.(target, { messageId: sent.message_id, numbered: true });
  } catch (err: unknown) {
    mctx.onLog(`[telegram] failed to send a question: ${getErrorMessage(err)}`);
    await deleteQueuedMessage(mctx, target);
    return false;
  }
  await deleteQueuedMessage(mctx, target);
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
    const sent = await bot.api.sendMessage(target.chatId, message.text, {
      ...(message.entities.length > 0 ? { entities: message.entities } : {}),
      reply_parameters: target.requestMessageId ? { message_id: target.requestMessageId } : undefined,
      link_preview_options: { is_disabled: true },
    });
    if (result.awaitingAnswer) mctx.onAgentAskShown?.(target, { messageId: sent.message_id, numbered: true });
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
