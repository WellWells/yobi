/**
 * What a bot does with a picture or a file someone hands it (Telegram, LINE PC): refused, read as
 * text, or uploaded to the model — decided from what the chat says of it, before anything is fetched.
 */
import {
  BYOK_IMAGE_MAX_FILES,
  PROVIDER_ATTACHMENT_POLICIES,
  PROVIDER_URLS,
  isByokTargetUrl,
  isModelUrlHidden,
  providerFromUrl,
} from '../../shared/types';
import type { HiddenSources } from '../../shared/types';
import { isByokImageFile, isTextLike, isUploadable, normalizeMime } from '../../shared/attachmentFormats';
import { byokTargetTakesImages } from '../providers/byokClient';
import { PROGRAM_EXTENSIONS, VIDEO_EXTENSIONS, declaredExtension } from '../executableFiles';

export { isTextLike, isUploadable } from '../../shared/attachmentFormats';

/** The most a bot takes in one picture or file (Telegram's Bot API download limit; LINE PC keeps to it too). */
export const BOT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export type BotMediaKind = 'photo' | 'document' | 'voice' | 'audio' | 'video';

/**
 * The request asks for a file to be made or changed, not read: a PDF, a conversion, an edit, a
 * picture cropped or zipped, a video's sound or subtitles, a QR code. Only a run has the tools for
 * those (`export_file`), so media with these words goes to one. A shortcut, not a gate on what the
 * run may do: a later message in the chat reaches the same tools.
 */
const MAKES_A_FILE = new RegExp([
  'pdf', 'zip', 'mp3', 'srt', 'jpe?g', 'png', 'webp', 'qr',
  '轉檔', '转档', '轉成', '转成', '轉為', '转为', '轉換', '转换', '另存', '匯出', '导出', '修改', '改成', '編輯', '编辑',
  '打包', '壓縮', '压缩', '裁切', '裁剪', '剪裁', '縮小', '缩小', '放大', '抽出', '擷取', '撷取', '提取', '音[訊檔频]', '字幕',
  '\\bconvert', '\\bedit\\b', '\\bexport', '\\bextract', '\\bcrop', '\\bresize', '\\bcompress', '\\baudio\\b', '\\bsubtitles?\\b',
].join('|'), 'i');

export function asksForAFile(text: string): boolean {
  return MAKES_A_FILE.test(text);
}

export type AttachmentRejectReason =
  | 'too-large'
  | 'audio-unsupported'
  | 'video-unsupported'
  | 'format-unsupported'
  | 'provider-cannot-upload'
  | 'context-full';

export type AttachmentPlan =
  | { route: 'upload' }
  | { route: 'inline' }
  /** Fetched for the run's tools (a video to make an MP3 of), never uploaded to the model. */
  | { route: 'tools' }
  | { route: 'reject'; reason: AttachmentRejectReason };

export interface AttachmentPlanOptions {
  /**
   * The request asks for a file to be made (`asksForAFile`) and goes to a run: a video or a
   * recording is fetched for its tools instead of refused. No model is shown it.
   */
  forTools?: boolean;
}

const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'amr',
]);

export interface AttachmentCandidate {
  kind: BotMediaKind;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
}

export function providerAttachmentCapacity(targetUrl: string): number {
  if (isByokTargetUrl(targetUrl)) return byokTargetTakesImages(targetUrl) ? BYOK_IMAGE_MAX_FILES : 0;
  return PROVIDER_ATTACHMENT_POLICIES[providerFromUrl(targetUrl)]?.maxFiles ?? 0;
}

export function resolveAttachmentPlan(
  candidate: AttachmentCandidate,
  targetUrl: string,
  options: AttachmentPlanOptions = {},
): AttachmentPlan {
  const { kind, mimeType, fileName, sizeBytes } = candidate;

  if (typeof sizeBytes === 'number' && sizeBytes > BOT_MEDIA_MAX_BYTES) {
    return { route: 'reject', reason: 'too-large' };
  }

  const mime = normalizeMime(mimeType);
  const ext = declaredExtension(fileName);
  // Programs, archives and disk images are never fetched, whatever the request (`executableFiles.ts`).
  if (PROGRAM_EXTENSIONS.has(ext)) return { route: 'reject', reason: 'format-unsupported' };

  const audio = kind === 'voice' || kind === 'audio' || mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext);
  // Not the declared type: an OS calls a .ts source file "video/mp2t".
  const video = kind === 'video' || VIDEO_EXTENSIONS.has(ext);
  // A conversion of a video or a recording (its sound as MP3, its subtitles): for the tools only.
  if ((audio || video) && options.forTools) return { route: 'tools' };
  if (audio) return { route: 'reject', reason: 'audio-unsupported' };
  // Whatever type the sender's client declares: no model reads a video. Scripts stay readable as text.
  if (video) return { route: 'reject', reason: 'video-unsupported' };

  const capacity = providerAttachmentCapacity(targetUrl);
  // A BYOK key that takes pictures takes nothing else: a PDF beside them still needs the fallback.
  const picturesOnly = isByokTargetUrl(targetUrl);
  const uploadOrRefuse = (picture: boolean): AttachmentPlan => (capacity > 0 && (picture || !picturesOnly)
    ? { route: 'upload' }
    : { route: 'reject', reason: 'provider-cannot-upload' });

  if (kind === 'photo') return uploadOrRefuse(true);

  if (isTextLike(mime, fileName)) return { route: 'inline' };
  if (isUploadable(mime, fileName)) return uploadOrRefuse(isByokImageFile(mime, fileName));

  return { route: 'reject', reason: 'format-unsupported' };
}

/**
 * The model that reads a picture or a file when the bot's own model cannot take it (Perplexity, a
 * BYOK key that reads no pictures, any BYOK key for a PDF): Gemini, unless the owner hid it.
 * Empty = no stand-in, the media is refused.
 */
export function uploadFallbackUrl(hidden: HiddenSources): string {
  return isModelUrlHidden(PROVIDER_URLS.gemini, hidden) ? '' : PROVIDER_URLS.gemini;
}

/**
 * Where a batch goes: `targetUrl`, or `fallbackUrl` when that model would refuse something in it
 * for want of uploads. Text files alone stay with the bot's model — they are inlined, not uploaded.
 */
export function uploadTargetFor(
  candidates: readonly AttachmentCandidate[],
  targetUrl: string,
  fallbackUrl: string,
): string {
  if (!fallbackUrl) return targetUrl;
  const refused = candidates.some((candidate) => {
    const plan = resolveAttachmentPlan(candidate, targetUrl);
    return plan.route === 'reject' && plan.reason === 'provider-cannot-upload';
  });
  return refused ? fallbackUrl : targetUrl;
}
