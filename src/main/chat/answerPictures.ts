import { keepImagesForChat } from '../chatMedia';
import { sendLog } from '../helpers';
import { t } from '../i18n';
import type { GeneratedImage } from '../providers/generatedImages';
import type { TelegramReplyTarget } from '../../shared/types';

type Strings = Record<string, string>;

/** What Telegram needs to send pictures: the runtime's own senders. */
export interface PictureSender {
  sendPictureReply(target: TelegramReplyTarget, files: readonly string[], caption: string): Promise<boolean>;
  sendProactiveFile(chatId: number, filePath: string, sendAs: 'auto', caption?: string, authorizedPaths?: string[]): Promise<void>;
  sendProactiveAlbum(chatId: number, filePaths: string[], caption?: string, authorizedPaths?: string[]): Promise<void>;
}

/** The answer's pictures kept with the chat's media, named after the provider that drew them. */
export function keepAnswerPictures(images: readonly GeneratedImage[] | undefined, providerLabel: string): Promise<string[]> {
  return images?.length ? keepImagesForChat(images, providerLabel) : Promise.resolve([]);
}

/**
 * The answer's words, or — when the provider drew pictures and wrote nothing — a line saying how
 * many, so the turn is never blank (a blank answer cannot be edited, copied or read aloud).
 */
export function answerTextWithPictures(response: string, pictures: number, strings: Strings): string {
  if (response.trim() || pictures === 0) return response;
  return t(strings, 'chat.image.drawn', { count: String(pictures) });
}

/** The provider's own words under its pictures: none when the answer is only the line saying how many. */
export function pictureCaption(text: string, pictures: number, strings: Strings): string {
  const words = text.trim();
  return words === answerTextWithPictures('', pictures, strings).trim() ? '' : words;
}

/**
 * An answer to a Telegram request. With pictures it is one message: the pictures replying to the
 * request, the provider's own words as their caption (none when it only drew — "1 picture made"
 * above the picture is noise; user 2026-10-19). When that cannot go (words longer than a caption,
 * pictures refused) the text goes as usual (`sendText`) and the pictures after it.
 */
export async function sendAnswerToTelegram(
  sender: PictureSender,
  target: TelegramReplyTarget,
  text: string,
  files: readonly string[],
  strings: Strings,
  sendText: () => Promise<void>,
): Promise<void> {
  if (files.length > 0 && await sender.sendPictureReply(target, files, pictureCaption(text, files.length, strings))) return;
  await sendText();
  await sendPicturesToTelegram(sender, target.chatId, files);
}

/**
 * The pictures to a Telegram chat, after the answer's text: one as a photo, several as an album.
 * The chat media folder is outside the outputs folder, so each file is authorised by name. A send
 * that fails is logged and leaves the text already sent standing.
 */
async function sendPicturesToTelegram(sender: PictureSender, chatId: number, files: readonly string[]): Promise<void> {
  if (files.length === 0) return;
  try {
    if (files.length === 1) await sender.sendProactiveFile(chatId, files[0], 'auto', undefined, [...files]);
    else await sender.sendProactiveAlbum(chatId, [...files], undefined, [...files]);
  } catch (err) {
    sendLog(`⚠️ [Bot] Pictures not sent to chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
