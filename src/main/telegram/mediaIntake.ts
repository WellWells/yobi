import type { Message, PhotoSize } from 'grammy/types';
import { t } from '../i18n';
import { inlineBudgetFor, truncateByMeasure } from '../chat/conversationContext';
import {
  resolveAttachmentPlan,
  type AttachmentPlan,
  type AttachmentRejectReason,
  type TelegramMediaKind,
} from './attachmentPlan';
import { deleteTempAttachments, downloadTelegramFile, readTextAttachment } from './fileDownload';
import { extractBotMention, type TelegramCommandOptions, type TelegramContext } from './commandHandlers';
import { getErrorMessage } from './errors';
import { fenceUntrusted } from '../../shared/promptFencing';

const ALBUM_DEBOUNCE_MS = 1_500;
const MAX_ALBUM_ITEMS = 10;

interface MediaItem {
  kind: TelegramMediaKind;
  fileId: string;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
}

const REJECT_KEYS: Record<AttachmentRejectReason, string> = {
  'too-large': 'telegram.media.reject.tooLarge',
  'audio-unsupported': 'telegram.media.reject.audio',
  'format-unsupported': 'telegram.media.reject.format',
  'provider-cannot-upload': 'telegram.media.reject.providerCannotUpload',
  'context-full': 'telegram.media.reject.contextFull',
};

export function largestPhoto(sizes: readonly PhotoSize[]): PhotoSize | null {
  let best: PhotoSize | null = null;
  for (const size of sizes) {
    if (!best || size.width * size.height > best.width * best.height) best = size;
  }
  return best;
}

export function extractMediaItem(msg: Message): MediaItem | null {
  if (msg.photo && msg.photo.length > 0) {
    const best = largestPhoto(msg.photo);
    if (!best) return null;
    return { kind: 'photo', fileId: best.file_id, mimeType: 'image/jpeg', sizeBytes: best.file_size };
  }
  if (msg.voice) {
    return {
      kind: 'voice',
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type,
      sizeBytes: msg.voice.file_size,
    };
  }
  if (msg.audio) {
    return {
      kind: 'audio',
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type,
      fileName: msg.audio.file_name,
      sizeBytes: msg.audio.file_size,
    };
  }
  if (msg.document) {
    return {
      kind: 'document',
      fileId: msg.document.file_id,
      mimeType: msg.document.mime_type,
      fileName: msg.document.file_name,
      sizeBytes: msg.document.file_size,
    };
  }
  return null;
}

export function safeLabel(fileName: string | undefined): string {
  const flattened = (fileName ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flattened) return 'file';
  return flattened.length > 80 ? `${flattened.slice(0, 80)}\u2026` : flattened;
}

function fallbackExtFor(item: MediaItem): string {
  if (item.kind === 'photo') return 'jpg';
  if (item.kind === 'voice') return 'oga';
  if (item.kind === 'audio') return 'mp3';
  return 'bin';
}

export interface MediaGate {
  allowed: boolean;
  addressed: boolean;
  prompt: string;
}

export function mediaGate(ctx: TelegramContext, options: TelegramCommandOptions): MediaGate {
  const deny: MediaGate = { allowed: false, addressed: false, prompt: '' };
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return deny;

  const caption = ctx.msg?.caption ?? '';
  if (chat.type === 'private') {
    if (!options.isPairedUser(from.id)) return deny;
    return { allowed: true, addressed: true, prompt: caption.trim() };
  }
  if (chat.type !== 'group' && chat.type !== 'supergroup') return deny;
  if (!options.allowGroupCommands()) return deny;
  if (!options.isPairedUser(from.id)) {
    if (caption) options.onLog(`[telegram] group media from unpaired user ${from.id} — ignored`);
    return deny;
  }

  const match = extractBotMention(caption, ctx.msg?.caption_entities, options.getBotUsername?.() ?? '');
  return { allowed: true, addressed: match.mentioned, prompt: match.mentioned ? match.prompt.trim() : '' };
}

export function shouldHandleMedia(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
): { handle: boolean; prompt: string } {
  const gate = mediaGate(ctx, options);
  return { handle: gate.allowed && gate.addressed, prompt: gate.prompt };
}

export function captionLooksLikeCommand(caption: string): boolean {
  return /^\/[a-z0-9_]{1,32}(@\S+)?(\s|$)/i.test(caption.trim());
}

function defaultPromptFor(items: readonly MediaItem[], strings: Record<string, string>): string {
  const allPhotos = items.every((item) => item.kind === 'photo');
  return t(strings, allPhotos ? 'telegram.media.defaultPrompt.image' : 'telegram.media.defaultPrompt.document');
}

interface PreparedBatch {
  attachments: string[];
  inlineBlocks: string[];
  rejections: AttachmentRejectReason[];
  failures: number;
  truncated: number;
}

async function prepareItems(
  items: readonly MediaItem[],
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  targetUrl: string,
): Promise<PreparedBatch> {
  const out: PreparedBatch = {
    attachments: [], inlineBlocks: [], rejections: [], failures: 0, truncated: 0,
  };
  const token = options.getBotToken?.() ?? '';
  const { budget, measure } = inlineBudgetFor(targetUrl, options.getByokContextBudgetChars?.() ?? 32_000);
  let remaining = budget;

  for (const item of items) {
    const plan: AttachmentPlan = resolveAttachmentPlan(
      { kind: item.kind, mimeType: item.mimeType, fileName: item.fileName, sizeBytes: item.sizeBytes },
      targetUrl,
    );
    if (plan.route === 'reject') {
      out.rejections.push(plan.reason);
      continue;
    }
    if (!token) {
      out.failures += 1;
      continue;
    }

    let localPath: string;
    try {
      const file = await ctx.api.getFile(item.fileId);
      if (!file.file_path) throw new Error('Telegram returned no file_path');
      localPath = await downloadTelegramFile({
        token,
        filePath: file.file_path,
        originalName: item.fileName,
        fallbackExt: fallbackExtFor(item),
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (/too big/i.test(message)) {
        out.rejections.push('too-large');
      } else {
        options.onLog(`[telegram] media download failed: ${message}`);
        out.failures += 1;
      }
      continue;
    }

    if (plan.route === 'upload') {
      out.attachments.push(localPath);
      continue;
    }

    const text = await readTextAttachment(localPath).catch(() => null);
    await deleteTempAttachments([localPath]);
    if (text === null) {
      out.rejections.push('format-unsupported');
      continue;
    }
    const header = `name: ${safeLabel(item.fileName)}\n\n`;
    const overhead = measure(fenceUntrusted('attached_file', header));
    const body = truncateByMeasure(text, Math.max(0, remaining - overhead), measure);
    if (!body) {
      out.rejections.push('context-full');
      continue;
    }
    if (body.length < text.length) out.truncated += 1;
    const block = fenceUntrusted('attached_file', `${header}${body}`);
    remaining -= measure(block);
    out.inlineBlocks.push(block);
  }
  return out;
}

async function processBatch(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  items: readonly MediaItem[],
  caption: string,
): Promise<void> {
  const strings = options.getStrings();
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return;

  const direct = options.getLlmDirect();
  if (!direct.enabled) {
    await ctx.reply(t(strings, 'telegram.direct.disabledHint'));
    return;
  }

  const targetUrl = options.getEffectiveTargetUrl?.() ?? direct.targetUrl;
  const capped = items.slice(0, MAX_ALBUM_ITEMS);
  const overflow = items.length - capped.length;
  const batch = await prepareItems(capped, ctx, options, targetUrl);

  if (batch.attachments.length === 0 && batch.inlineBlocks.length === 0) {
    if (batch.rejections.length > 0) {
      await ctx.reply(t(strings, REJECT_KEYS[batch.rejections[0]]));
    } else {
      await ctx.reply(t(strings, 'telegram.media.reject.downloadFailed'));
    }
    return;
  }

  const skipped = batch.rejections.length + batch.failures + overflow;
  if (skipped > 0) {
    await ctx.reply(t(strings, 'telegram.media.partial', { count: String(skipped) }))
      .catch(() => {});
  }
  if (batch.truncated > 0) {
    await ctx.reply(t(strings, 'telegram.media.truncated', { count: String(batch.truncated) }))
      .catch(() => {});
  }

  const promptParts = [caption || defaultPromptFor(capped, strings), ...batch.inlineBlocks];
  await queueMediaTask(ctx, options, {
    prompt: promptParts.join('\n\n'),
    targetUrl: direct.targetUrl,
    attachments: batch.attachments,
  });
}

async function queueMediaTask(
  ctx: TelegramContext,
  options: TelegramCommandOptions,
  params: { prompt: string; targetUrl: string; attachments: string[] },
): Promise<void> {
  const strings = options.getStrings();
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return;

  let queuedMessageId: number | undefined;
  let enqueued = false;
  try {
    const queuedMessage = await ctx.reply(t(strings, 'telegram.cmd.queued'));
    queuedMessageId = queuedMessage.message_id;
    const queued = await options.onTaskRequest({
      command: 'direct',
      prompt: params.prompt,
      targetUrl: params.targetUrl,
      ...(params.attachments.length > 0 ? { attachments: params.attachments } : {}),
      replyTarget: {
        chatId: chat.id,
        userId: from.id,
        requestMessageId: ctx.msg?.message_id,
        queuedMessageId,
        command: 'direct',
      },
      requesterName: from.first_name,
    });
    enqueued = true;
    await ctx.api.editMessageText(
      chat.id,
      queuedMessage.message_id,
      t(strings, 'telegram.cmd.queuedWithId', { taskId: queued.taskId }),
    ).catch(() => {});
  } catch (err: unknown) {
    if (enqueued) {
      options.onLog(`[telegram] media task queued but acknowledgement failed: ${getErrorMessage(err)}`);
      return;
    }
    await deleteTempAttachments(params.attachments);
    options.onLog(`[telegram] failed to queue media task: ${getErrorMessage(err)}`);
    if (queuedMessageId) {
      try {
        await ctx.api.editMessageText(chat.id, queuedMessageId, t(strings, 'telegram.cmd.queueFailed'));
        return;
      } catch {
      }
    }
    await ctx.reply(t(strings, 'telegram.cmd.queueFailed'));
  }
}

export interface MediaIntake {
  handle: (ctx: TelegramContext) => Promise<void>;
  handleUnsupported: (ctx: TelegramContext) => Promise<void>;
  dispose: () => void;
}

export function createMediaIntake(options: TelegramCommandOptions): MediaIntake {
  interface PendingAlbum {
    items: MediaItem[];
    caption: string;
    addressed: boolean;
    captionIsCommand: boolean;
    ctx: TelegramContext;
    timer: ReturnType<typeof setTimeout>;
  }
  const albums = new Map<string, PendingAlbum>();

  const flush = (key: string): void => {
    const pending = albums.get(key);
    if (!pending) return;
    albums.delete(key);
    if (!pending.addressed) return;

    const { ctx } = pending;
    if (ctx.chat && ctx.from) options.onDropAgentAsk?.(ctx.chat.id, ctx.from.id);
    if (pending.captionIsCommand) {
      void ctx.reply(t(options.getStrings(), 'telegram.media.captionCommand'))
        .catch((err: unknown) => options.onLog(`[telegram] album reply failed: ${getErrorMessage(err)}`));
      return;
    }
    void processBatch(ctx, options, pending.items, pending.caption)
      .catch((err: unknown) => options.onLog(`[telegram] album batch failed: ${getErrorMessage(err)}`));
  };

  return {
    handle: async (ctx) => {
      const msg = ctx.msg;
      if (!msg) return;
      const gate = mediaGate(ctx, options);
      if (!gate.allowed) return;

      const item = extractMediaItem(msg);
      if (!item) return;
      const groupId = msg.media_group_id;

      if (!groupId) {
        if (!gate.addressed) return;
        if (ctx.chat && ctx.from) options.onDropAgentAsk?.(ctx.chat.id, ctx.from.id);
        if (captionLooksLikeCommand(gate.prompt)) {
          await ctx.reply(t(options.getStrings(), 'telegram.media.captionCommand'));
          return;
        }
        await processBatch(ctx, options, [item], gate.prompt);
        return;
      }

      const key = `${ctx.chat?.id ?? 0}:${groupId}`;
      const pending = albums.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        pending.items.push(item);
        if (gate.addressed) {
          pending.addressed = true;
          if (!pending.caption && gate.prompt) pending.caption = gate.prompt;
          if (captionLooksLikeCommand(gate.prompt)) pending.captionIsCommand = true;
        }
        pending.timer = setTimeout(() => flush(key), ALBUM_DEBOUNCE_MS);
        return;
      }
      albums.set(key, {
        items: [item],
        caption: gate.prompt,
        addressed: gate.addressed,
        captionIsCommand: gate.addressed && captionLooksLikeCommand(gate.prompt),
        ctx,
        timer: setTimeout(() => flush(key), ALBUM_DEBOUNCE_MS),
      });
    },

    handleUnsupported: async (ctx) => {
      const gate = mediaGate(ctx, options);
      if (!gate.allowed || !gate.addressed) return;
      if (!options.getLlmDirect().enabled) {
        await ctx.reply(t(options.getStrings(), 'telegram.direct.disabledHint'));
        return;
      }
      await ctx.reply(t(options.getStrings(), 'telegram.media.unsupportedType'));
    },

    dispose: () => {
      for (const pending of albums.values()) clearTimeout(pending.timer);
      albums.clear();
    },
  };
}
