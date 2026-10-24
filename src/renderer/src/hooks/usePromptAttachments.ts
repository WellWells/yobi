import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ATTACHMENT_STASH_MAX_BYTES,
  BYOK_IMAGE_MAX_FILES,
  PROVIDER_ATTACHMENT_POLICIES,
  PROVIDER_LABELS,
  isByokTargetUrl,
  providerFromUrl,
  type PromptAttachment,
  type StashedAttachment,
} from '../../../shared/types';
import { BYOK_IMAGE_ACCEPT, attachmentAcceptFor, isByokImageFile } from '../../../shared/attachmentFormats';
import { fillTemplate } from '../../../shared/fillTemplate';
import { attachmentApi, systemApi } from '../api/electronApi';
import { imageThumbnailDataUrl } from '../utils/imageThumbnail';
import { useAppStore } from '../store/appStore';

let attachmentSeq = 0;

function nextAttachmentId(): string {
  attachmentSeq += 1;
  return `att-${attachmentSeq}`;
}

type IntakeFailure = 'noPath' | 'tooLarge';

function isFailure(value: PromptAttachment | IntakeFailure): value is IntakeFailure {
  return typeof value === 'string';
}

async function resolveAttachment(file: File): Promise<PromptAttachment | IntakeFailure> {
  const previewUrl = (await imageThumbnailDataUrl(file)) ?? undefined;

  let path = '';
  try {
    path = systemApi.getPathForFile(file);
  } catch {
    path = '';
  }
  if (path) {
    return { id: nextAttachmentId(), name: file.name, size: file.size, mimeType: file.type, path, previewUrl };
  }

  if (file.size > ATTACHMENT_STASH_MAX_BYTES) return 'tooLarge';
  try {
    const stashed = await attachmentApi.stashBytes({
      name: file.name,
      mimeType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return { ...fromStashed(stashed), previewUrl: previewUrl ?? stashed.preview };
  } catch {
    return 'noPath';
  }
}

function fromStashed(stashed: StashedAttachment): PromptAttachment {
  return {
    id: nextAttachmentId(),
    name: stashed.name,
    size: stashed.size,
    mimeType: stashed.mimeType,
    path: stashed.path,
    previewUrl: stashed.preview,
  };
}

export interface UsePromptAttachmentsResult {
  attachments: PromptAttachment[];
  maxFiles: number;
  unsupportedReason: string | null;
  /** What the target takes when it takes only some files (a BYOK key: pictures); null = no limit. */
  restriction: string | null;
  accept: string;
  notice: string | null;
  addFiles: (files: File[]) => void;
  addFromClipboard: () => void;
  /** A file main already wrote (the region hotkey's picture), under the same rules as a paste. */
  addStashed: (stashed: StashedAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  dismissNotice: () => void;
}

export function usePromptAttachments(
  modelUrl: string,
  t: (key: string) => string,
): UsePromptAttachmentsResult {
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const byokModels = useAppStore((s) => s.byokModels);
  const byokGroupModels = useAppStore((s) => s.byokGroupModels);
  const isByokTarget = isByokTargetUrl(modelUrl);
  const provider = providerFromUrl(modelUrl);
  const byokOption = isByokTarget ? [...byokModels, ...byokGroupModels].find((m) => m.url === modelUrl) : undefined;
  /** A BYOK key that reads pictures takes them and nothing else. */
  const imagesOnly = byokOption?.imageInput === true;
  const maxFiles = isByokTarget
    ? (imagesOnly ? BYOK_IMAGE_MAX_FILES : 0)
    : PROVIDER_ATTACHMENT_POLICIES[provider].maxFiles;
  const providerLabel = isByokTarget ? byokOption?.label ?? 'BYOK' : PROVIDER_LABELS[provider];

  const attachmentsRef = useRef<PromptAttachment[]>([]);
  attachmentsRef.current = attachments;

  const limitNotice = useCallback(
    () => fillTemplate(t('attach.limit.reached'), { max: maxFiles }),
    [maxFiles, t],
  );

  const unsupportedReason = useMemo(
    () => (maxFiles > 0 ? null : fillTemplate(t('attach.unsupported'), { provider: providerLabel })),
    [maxFiles, providerLabel, t],
  );

  const restriction = useMemo(
    () => (imagesOnly ? fillTemplate(t('attach.imagesOnly'), { provider: providerLabel }) : null),
    [imagesOnly, providerLabel, t],
  );

  const commit = useCallback((accepted: PromptAttachment[]): number => {
    const current = attachmentsRef.current;
    const room = Math.max(0, maxFiles - current.length);
    const kept = accepted.slice(0, room);
    if (kept.length === 0) return 0;
    const next = [...current, ...kept];
    attachmentsRef.current = next;
    setAttachments(next);
    return kept.length;
  }, [maxFiles]);

  const addFiles = useCallback((dropped: File[]) => {
    if (dropped.length === 0) return;
    if (unsupportedReason) {
      setNotice(unsupportedReason);
      return;
    }
    const incoming = imagesOnly ? dropped.filter((file) => isByokImageFile(file.type, file.name)) : dropped;
    const refused = dropped.length - incoming.length;
    if (incoming.length === 0) {
      setNotice(restriction);
      return;
    }
    const room = Math.max(0, maxFiles - attachmentsRef.current.length);
    if (room <= 0) {
      setNotice(limitNotice());
      return;
    }
    const taken = incoming.slice(0, room);
    void (async () => {
      const resolved = await Promise.all(taken.map(resolveAttachment));
      const accepted = resolved.filter((entry): entry is PromptAttachment => !isFailure(entry));
      const stored = commit(accepted);

      const notices: string[] = [];
      if (refused > 0 && restriction) notices.push(restriction);
      if (resolved.includes('tooLarge')) notices.push(t('attach.tooLarge'));
      if (resolved.includes('noPath')) notices.push(t('attach.noPath'));
      if (incoming.length > room || stored < accepted.length) notices.push(limitNotice());
      setNotice(notices.length > 0 ? notices.join(' ') : null);
    })();
  }, [commit, imagesOnly, limitNotice, maxFiles, restriction, t, unsupportedReason]);

  /** Why the composer cannot take one more file right now, or null when it can. */
  const refusal = useCallback((): string | null => {
    if (unsupportedReason) return unsupportedReason;
    if (attachmentsRef.current.length >= maxFiles) return limitNotice();
    return null;
  }, [limitNotice, maxFiles, unsupportedReason]);

  const takeStashed = useCallback((stashed: StashedAttachment) => {
    const refused = refusal();
    if (refused) {
      setNotice(refused);
      return;
    }
    if (imagesOnly && !isByokImageFile(stashed.mimeType, stashed.name)) {
      setNotice(restriction);
      return;
    }
    setNotice(commit([fromStashed(stashed)]) > 0 ? null : limitNotice());
  }, [commit, imagesOnly, limitNotice, refusal, restriction]);

  const addFromClipboard = useCallback(() => {
    const refused = refusal();
    if (refused) {
      setNotice(refused);
      return;
    }
    void (async () => {
      let stashed: StashedAttachment | null = null;
      try {
        stashed = await attachmentApi.fromClipboard();
      } catch {
        stashed = null;
      }
      if (!stashed) {
        setNotice(t('attach.clipboard.empty'));
        return;
      }
      takeStashed(stashed);
    })();
  }, [refusal, t, takeStashed]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
    setNotice(null);
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setNotice(null);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    const current = attachmentsRef.current;
    if (current.length === 0) return;
    if (unsupportedReason) {
      attachmentsRef.current = [];
      setAttachments([]);
      setNotice(unsupportedReason);
      return;
    }
    // Switched to a key that takes only pictures: a PDF chosen for Gemini cannot come along.
    const allowed = imagesOnly ? current.filter((item) => isByokImageFile(item.mimeType, item.name)) : current;
    const kept = allowed.slice(0, maxFiles);
    if (kept.length === current.length) return;
    attachmentsRef.current = kept;
    setAttachments(kept);
    setNotice(allowed.length < current.length ? restriction : limitNotice());
  }, [imagesOnly, limitNotice, maxFiles, restriction, unsupportedReason]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return {
    attachments,
    maxFiles,
    unsupportedReason,
    restriction,
    accept: imagesOnly ? BYOK_IMAGE_ACCEPT : attachmentAcceptFor(provider),
    notice,
    addFiles,
    addFromClipboard,
    addStashed: takeStashed,
    removeAttachment,
    clearAttachments,
    dismissNotice,
  };
}
