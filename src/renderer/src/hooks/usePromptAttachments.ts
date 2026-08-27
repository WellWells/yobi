import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ATTACHMENT_STASH_MAX_BYTES,
  PROVIDER_ATTACHMENT_POLICIES,
  PROVIDER_LABELS,
  isByokTargetUrl,
  providerFromUrl,
  type PromptAttachment,
  type StashedAttachment,
} from '../../../shared/types';
import { attachmentAcceptFor } from '../../../shared/attachmentFormats';
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
  accept: string;
  notice: string | null;
  addFiles: (files: File[]) => void;
  addFromClipboard: () => void;
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
  const maxFiles = isByokTarget ? 0 : PROVIDER_ATTACHMENT_POLICIES[provider].maxFiles;
  const providerLabel = isByokTarget
    ? ([...byokModels, ...byokGroupModels].find((m) => m.url === modelUrl)?.label ?? 'BYOK')
    : PROVIDER_LABELS[provider];

  const attachmentsRef = useRef<PromptAttachment[]>([]);
  attachmentsRef.current = attachments;

  const limitNotice = useCallback(
    () => t('attach.limit.reached').replace('{{max}}', String(maxFiles)),
    [maxFiles, t],
  );

  const unsupportedReason = useMemo(
    () => (maxFiles > 0 ? null : t('attach.unsupported').replace('{{provider}}', providerLabel)),
    [maxFiles, providerLabel, t],
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

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    if (unsupportedReason) {
      setNotice(unsupportedReason);
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
      if (resolved.includes('tooLarge')) notices.push(t('attach.tooLarge'));
      if (resolved.includes('noPath')) notices.push(t('attach.noPath'));
      if (incoming.length > room || stored < accepted.length) notices.push(limitNotice());
      setNotice(notices.length > 0 ? notices.join(' ') : null);
    })();
  }, [commit, limitNotice, maxFiles, t, unsupportedReason]);

  const addFromClipboard = useCallback(() => {
    if (unsupportedReason) {
      setNotice(unsupportedReason);
      return;
    }
    if (attachmentsRef.current.length >= maxFiles) {
      setNotice(limitNotice());
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
      setNotice(commit([fromStashed(stashed)]) > 0 ? null : limitNotice());
    })();
  }, [commit, limitNotice, maxFiles, t, unsupportedReason]);

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
    } else if (current.length > maxFiles) {
      const kept = current.slice(0, maxFiles);
      attachmentsRef.current = kept;
      setAttachments(kept);
      setNotice(limitNotice());
    }
  }, [limitNotice, maxFiles, unsupportedReason]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return {
    attachments,
    maxFiles,
    unsupportedReason,
    accept: attachmentAcceptFor(provider),
    notice,
    addFiles,
    addFromClipboard,
    removeAttachment,
    clearAttachments,
    dismissNotice,
  };
}
