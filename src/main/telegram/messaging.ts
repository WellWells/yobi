import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { InputFile } from 'grammy';
import type { TelegramReplyMode, TelegramReplyTarget } from '../../shared/types';
import { getOutputDir } from '../files';
import { getLangCache, t } from '../i18n';
import { getErrorMessage } from './errors';
import {
  escapeTelegramHtml,
  extractResponseSection,
  formatResponseForTelegramHtml,
  splitMarkdownIntoChunks,
  telegramVisibleLength,
  truncateText,
} from './formatter';
import { buildExportCallbackData, type ExportTokenRegistry } from './exporter';
import { fetchOptimizedImage } from './remoteImage';
import {
  safeSendMessage,
  sendDirectExport,
  type TelegramSendContext,
} from './exportHandlers';

const TELEGRAM_MSG_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_RESULT_MAX = 2600;
// Compact replies carry no header, so a chunk gets the whole message budget
// minus room for the HTML tags markdown rendering adds.
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

export async function sendProactive(
  mctx: TelegramMessagingContext,
  chatId: number,
  text: string,
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

    if (message.length > TELEGRAM_MSG_LIMIT) {
      const buffer = Buffer.from(responseSection || text, 'utf8');
      await bot.api.sendDocument(chatId, new InputFile(buffer, 'output.md'), {
        caption: t(getLangCache(), 'telegram.flowOutputTooLong', {}),
      });
    } else {
      await bot.api.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (err: unknown) {
    mctx.onLog(`[telegram] sendProactive failed for chat ${chatId}: ${String(err)}`);
    throw err;
  }
}

async function resolveSafeLocalAttachment(
  filePath: string,
  authorizedPaths: string[] = [],
): Promise<string> {
  if (filePath.includes('\0')) {
    throw new Error('Attachment path is invalid (contains a NUL byte)');
  }
  const resolved = await fs.realpath(filePath).catch(() => path.resolve(filePath));

  for (const candidate of authorizedPaths) {
    const authResolved = await fs.realpath(candidate).catch(() => path.resolve(candidate));
    if (authResolved === resolved) return resolved;
  }

  if (/^[\\/]{2}/.test(filePath)) {
    throw new Error('Attachment must be a local file or an http(s) URL, not a network path');
  }
  const root = await fs.realpath(await getOutputDir()).catch(() => path.resolve('.'));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Attachment is outside the Yobi output folder and was blocked');
  }
  return resolved;
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

export async function sendProactiveFile(
  mctx: TelegramMessagingContext,
  chatId: number,
  filePath: string,
  sendAs: 'photo' | 'document' | 'auto',
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
  const captionOpts = captionHtml
    ? { caption: captionHtml, parse_mode: 'HTML' as const }
    : {};
  try {
    const isRemote = /^https?:\/\//i.test(filePath);
    const resolvedLocal = isRemote ? '' : await resolveSafeLocalAttachment(filePath, authorizedPaths);
    const media = (): string | InputFile => (isRemote ? filePath : new InputFile(resolvedLocal));

    let mode: 'photo' | 'document' = sendAs === 'auto' ? 'photo' : sendAs;
    if (sendAs === 'auto' && !isRemote) {
      mode = (await fileLooksLikeImage(resolvedLocal)) ? 'photo' : 'document';
    }

    // Telegram downloads remote media on its own servers; hotlink-protected hosts
    // serve HTML to that fetcher, so sendPhoto/sendDocument by URL fail. For remote
    // photos, download + optimize the image ourselves (in memory, never on disk) and
    // upload the bytes so Telegram receives a valid, size-optimized image.
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

// 'direct' is the synthetic command that command-free chat queues under — not a
// slash command the user typed — so headers show a localized label instead.
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

  // Compact: the answer and nothing else. The markdown file is still written to
  // the output folder, it just goes unannounced, and no export token is issued.
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

// An answer longer than one Telegram message continues into the next one, the
// way a person sends a long thought. Only the first message quotes the request.
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
  // Sequential: Telegram orders messages by call order, and a reply chain that
  // starts with its second half reads backwards.
  for (const [index, chunk] of chunks.entries()) {
    const body = renderCompactChunk(chunk) || emptyBody;
    await safeSendMessage(mctx, target.chatId, body, index === 0 ? target.requestMessageId : undefined);
  }
}

// Rendering grows the source (entity escapes, <a href="…">), so a chunk that fit
// as markdown can still overflow as HTML. Shorten the source and re-render
// rather than cutting the HTML, which would leave a tag unclosed.
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
