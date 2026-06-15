import { InputFile, type Bot } from 'grammy';
import { t } from '../i18n';
import { getErrorMessage } from './errors';
import { escapeTelegramHtml } from './formatter';
import {
  TELEGRAM_EXPORT_CB_PREFIX,
  parseExportCallbackData,
  type ExportTokenRegistry,
  type TelegramExportContext,
  type TelegramExportFormat,
} from './exporter';
import type { TelegramContext } from './commandHandlers';

type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export interface TelegramSendContext {
  getBot: () => Bot<TelegramContext> | null;
  getStrings: () => Record<string, string>;
  onLog: (message: string) => void;
  onExportRequest: (
    request: TelegramExportContext & { format: TelegramExportFormat },
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
}

export async function safeSendMessage(
  sctx: TelegramSendContext,
  chatId: number,
  text: string,
  replyToMessageId?: number,
  replyMarkup?: TelegramInlineKeyboard,
): Promise<void> {
  const bot = sctx.getBot();
  if (!bot) return;
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
      reply_markup: replyMarkup,
      link_preview_options: { is_disabled: true },
    });
  } catch (err: unknown) {
    sctx.onLog(`[telegram] failed to send message: ${getErrorMessage(err)}`);
  }
}

export async function handleExportCallback(
  ctx: TelegramContext,
  registry: ExportTokenRegistry,
  sctx: TelegramSendContext,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith(`${TELEGRAM_EXPORT_CB_PREFIX}:`)) return;
  const parsed = parseExportCallbackData(data);
  const s = sctx.getStrings();
  if (!parsed) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.invalidExport'), show_alert: true });
    return;
  }
  if (!ctx.from) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.unidentifiedAccount'), show_alert: true });
    return;
  }

  const record = registry.get(parsed.token);
  if (!record) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.exportExpired'), show_alert: true });
    return;
  }
  if (record.userId !== ctx.from.id) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.exportOtherUser'), show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: t(s, 'telegram.msg.preparingFormat', { format: parsed.format.toUpperCase() }) });
  const exportResult = await sctx.onExportRequest({
    ...record,
    format: parsed.format,
  });
  if (!exportResult.ok || !exportResult.filePath) {
    const message = escapeTelegramHtml(exportResult.error || t(s, 'telegram.msg.exportFailed', { format: parsed.format.toUpperCase() }));
    await safeSendMessage(sctx, record.chatId, `<i>${message}</i>`);
    return;
  }

  await uploadExportDocument(sctx, {
    chatId: record.chatId,
    filePath: exportResult.filePath,
    providerLabel: record.providerLabel,
    format: parsed.format,
  });
}

export async function sendDirectExport(
  sctx: TelegramSendContext,
  request: TelegramExportContext & { format: TelegramExportFormat; replyToMessageId?: number },
): Promise<void> {
  const s = sctx.getStrings();
  const exportResult = await sctx.onExportRequest(request);
  if (!exportResult.ok || !exportResult.filePath) {
    const message = escapeTelegramHtml(exportResult.error || t(s, 'telegram.msg.exportFailed', { format: request.format.toUpperCase() }));
    await safeSendMessage(sctx, request.chatId, `<i>${message}</i>`);
    return;
  }
  await uploadExportDocument(sctx, {
    chatId: request.chatId,
    filePath: exportResult.filePath,
    providerLabel: request.providerLabel,
    format: request.format,
    replyToMessageId: request.replyToMessageId,
  });
}

async function uploadExportDocument(
  sctx: TelegramSendContext,
  payload: {
    chatId: number;
    filePath: string;
    providerLabel: string;
    format: TelegramExportFormat;
    replyToMessageId?: number;
  },
): Promise<void> {
  const bot = sctx.getBot();
  if (!bot) return;
  const s = sctx.getStrings();
  try {
    await bot.api.sendDocument(payload.chatId, new InputFile(payload.filePath), {
      caption: t(s, 'telegram.msg.exportCaption', {
        provider: payload.providerLabel,
        format: payload.format.toUpperCase(),
      }),
      reply_parameters: payload.replyToMessageId ? { message_id: payload.replyToMessageId } : undefined,
    });
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    sctx.onLog(`[telegram] failed to upload ${payload.format}: ${message}`);
    await safeSendMessage(
      sctx,
      payload.chatId,
      `<i>${escapeTelegramHtml(t(s, 'telegram.msg.uploadFailed', { error: message }))}</i>`,
    );
  }
}
