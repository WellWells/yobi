import React, { useCallback, useMemo, useState } from 'react';
import type { TurnAttachment } from '../../../../shared/conversationDoc';
import { turnMediaKind } from '../../../../shared/turnMedia';
import { useI18nStore } from '../../store/i18nStore';
import { AttachmentChips } from './AttachmentChips';
import type { AttachmentChipItem } from './AttachmentChips';
import { openTurnFile, useTurnFileMenu } from './TurnFileMenu';
import { TurnMedia } from './TurnMedia';

function showsItself(file: string): boolean {
  const kind = turnMediaKind(file);
  return kind === 'image' || kind === 'video';
}

/**
 * Photos and videos draw themselves. Anything else is a chip with its name, and so is a turn from
 * before files were kept, or a picture whose file is gone since (`gone`): the name still says what
 * was sent.
 */
export function splitTurnAttachments(
  attachments: readonly TurnAttachment[],
  gone: ReadonlySet<string>,
): { media: string[]; chips: AttachmentChipItem[] } {
  const media: string[] = [];
  const chips: AttachmentChipItem[] = [];
  attachments.forEach(({ name, path }, index) => {
    const file = path && !gone.has(path) ? path : undefined;
    if (file && showsItself(file)) media.push(file);
    else chips.push({ id: `${index}-${name}`, name, ...(file ? { path: file } : {}) });
  });
  return { media, chips };
}

/** What was sent with a prompt, inside its bubble. */
export const TurnAttachments: React.FC<{ attachments: readonly TurnAttachment[] }> = ({ attachments }) => {
  const t = useI18nStore((s) => s.t);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const { openMenu, menu } = useTurnFileMenu();
  const { media, chips } = useMemo(() => splitTurnAttachments(attachments, gone), [attachments, gone]);
  const markGone = useCallback((file: string): void => setGone((prev) => new Set(prev).add(file)), []);
  const open = useCallback((file: string): void => openTurnFile(file, t), [t]);

  return (
    <>
      {media.length > 0 && <TurnMedia files={media} compact onMissing={markGone} />}
      {chips.length > 0 && <AttachmentChips attachments={chips} onOpen={open} onOpenMenu={openMenu} />}
      {menu}
    </>
  );
};
