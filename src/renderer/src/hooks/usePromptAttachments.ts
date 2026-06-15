import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROVIDER_ATTACHMENT_POLICIES,
  PROVIDER_LABELS,
  providerFromUrl,
  type PromptAttachment,
} from '../../../shared/types';
import { systemApi } from '../api/electronApi';

let attachmentSeq = 0;

function buildAttachment(file: File): PromptAttachment {
  let path = '';
  try {
    path = systemApi.getPathForFile(file);
  } catch {
    path = '';
  }
  const isImage = file.type.startsWith('image/');
  return {
    id: `att-${(attachmentSeq += 1)}`,
    name: file.name,
    size: file.size,
    mimeType: file.type,
    path,
    previewUrl: isImage ? URL.createObjectURL(file) : undefined,
  };
}

function revokePreview(attachment: PromptAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

export interface UsePromptAttachmentsResult {
  attachments: PromptAttachment[];
  maxFiles: number;
  notice: string | null;
  addFiles: (files: File[]) => void;
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

  const provider = providerFromUrl(modelUrl);
  const maxFiles = PROVIDER_ATTACHMENT_POLICIES[provider].maxFiles;

  const attachmentsRef = useRef<PromptAttachment[]>([]);
  attachmentsRef.current = attachments;

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    if (maxFiles <= 0) {
      setNotice(t('attach.unsupported').replace('{{provider}}', PROVIDER_LABELS[provider]));
      return;
    }
    const built = incoming.map(buildAttachment);
    // Files dragged straight from a browser/email/zip have no filesystem path
    // and can never be uploaded — reject them instead of showing a dead chip.
    const pathless = built.filter((a) => !a.path);
    pathless.forEach(revokePreview);
    const usable = built.filter((a) => a.path);

    const current = attachmentsRef.current;
    const room = Math.max(0, maxFiles - current.length);
    if (room <= 0) {
      usable.forEach(revokePreview);
      setNotice(t('attach.limit.reached').replace('{{max}}', String(maxFiles)));
      return;
    }
    const accepted = usable.slice(0, room);
    usable.slice(room).forEach(revokePreview);
    const next = [...current, ...accepted];
    attachmentsRef.current = next;
    setAttachments(next);
    const notices: string[] = [];
    if (pathless.length > 0) notices.push(t('attach.noPath'));
    if (usable.length > room) notices.push(t('attach.limit.reached').replace('{{max}}', String(maxFiles)));
    setNotice(notices.length > 0 ? notices.join(' ') : null);
  }, [maxFiles, provider, t]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) revokePreview(target);
      return prev.filter((item) => item.id !== id);
    });
    setNotice(null);
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach(revokePreview);
      return [];
    });
    setNotice(null);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // Switching to a provider that accepts fewer/no files must drop the excess
  // (and tell the user), never silently carry unsendable attachments.
  useEffect(() => {
    const current = attachmentsRef.current;
    if (current.length === 0) return;
    if (maxFiles <= 0) {
      current.forEach(revokePreview);
      attachmentsRef.current = [];
      setAttachments([]);
      setNotice(t('attach.unsupported').replace('{{provider}}', PROVIDER_LABELS[provider]));
    } else if (current.length > maxFiles) {
      current.slice(maxFiles).forEach(revokePreview);
      const kept = current.slice(0, maxFiles);
      attachmentsRef.current = kept;
      setAttachments(kept);
      setNotice(t('attach.limit.reached').replace('{{max}}', String(maxFiles)));
    }
  }, [provider, maxFiles, t]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => () => {
    attachmentsRef.current.forEach(revokePreview);
  }, []);

  return {
    attachments,
    maxFiles,
    notice,
    addFiles,
    removeAttachment,
    clearAttachments,
    dismissNotice,
  };
}
