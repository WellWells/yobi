import {
  PROVIDER_ATTACHMENT_POLICIES,
  isByokTargetUrl,
  providerFromUrl,
} from '../../shared/types';
import { isTextLike, isUploadable, normalizeMime } from '../../shared/attachmentFormats';

export { extensionOf, isTextLike, isUploadable } from '../../shared/attachmentFormats';

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

export interface AttachmentCandidate {
  kind: TelegramMediaKind;
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
}

export function providerAttachmentCapacity(targetUrl: string): number {
  if (isByokTargetUrl(targetUrl)) return 0;
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

  if (kind === 'voice' || kind === 'audio' || mime.startsWith('audio/')) {
    return { route: 'reject', reason: 'audio-unsupported' };
  }

  const capacity = providerAttachmentCapacity(targetUrl);
  const uploadOrRefuse = (): AttachmentPlan => (capacity > 0
    ? { route: 'upload' }
    : { route: 'reject', reason: 'provider-cannot-upload' });

  if (kind === 'photo') return uploadOrRefuse();

  if (isTextLike(mime, fileName)) return { route: 'inline' };
  if (isUploadable(mime, fileName)) return uploadOrRefuse();

  return { route: 'reject', reason: 'format-unsupported' };
}
