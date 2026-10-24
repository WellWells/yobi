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

export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export type TelegramMediaKind = 'photo' | 'document' | 'voice' | 'audio';

export type AttachmentRejectReason =
  | 'too-large'
  | 'audio-unsupported'
  | 'format-unsupported'
  | 'provider-cannot-upload'
  | 'context-full';

export type AttachmentPlan =
  | { route: 'upload' }
  | { route: 'inline' }
  | { route: 'reject'; reason: AttachmentRejectReason };

const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'amr',
]);

export interface AttachmentCandidate {
  kind: TelegramMediaKind;
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
): AttachmentPlan {
  const { kind, mimeType, fileName, sizeBytes } = candidate;

  if (typeof sizeBytes === 'number' && sizeBytes > TELEGRAM_MAX_DOWNLOAD_BYTES) {
    return { route: 'reject', reason: 'too-large' };
  }

  const mime = normalizeMime(mimeType);
  const ext = declaredExtension(fileName);

  if (kind === 'voice' || kind === 'audio' || mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) {
    return { route: 'reject', reason: 'audio-unsupported' };
  }
  // Never fetched, whatever type the sender's client declares: programs, archives, disk images
  // (`executableFiles.ts`) and video — no model reads them. Scripts stay readable as text.
  if (PROGRAM_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
    return { route: 'reject', reason: 'format-unsupported' };
  }

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
