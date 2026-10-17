import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/appStore';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import { RewriteResultCard } from './RewriteResultCard';

interface RewriteCardHostProps {
  /** The conversation on screen: its file path, or the temporary chat's key. */
  path: string;
  t: (key: string) => string;
}

/**
 * Puts the result card of a rewrite started from a selection right after the block that was
 * selected, inside the answer, so the result reads next to what it replaces. The answer is
 * rendered Markdown, so the card goes into a holder placed after that block; if the block has
 * been re-rendered away (the file reloaded), it falls back to the answer's own slot at its end.
 */
export const RewriteCardHost: React.FC<RewriteCardHostProps> = ({ path, t }) => {
  const job = useWritingToolsStore((s) => s.job);
  const anchor = useWritingToolsStore((s) => s.anchor);
  // A reload re-renders the answer and may drop the anchor block, so placement is redone; so does
  // opening or closing the editor on that turn, which takes the rendered answer away and back.
  const fileContent = useAppStore((s) => s.fileContent);
  const editing = useAnswerEditStore((s) => (
    job ? Boolean(s.drafts[draftKey(job.target.path, job.target.turnIndex)]) : false
  ));
  const [holder, setHolder] = useState<HTMLElement | null>(null);

  const jobId = job?.id ?? null;
  const shown = job !== null && job.target.kind === 'file' && job.target.path === path;
  const turnIndex = job?.target.turnIndex ?? -1;

  useLayoutEffect(() => {
    if (!shown) {
      setHolder(null);
      return;
    }
    if (anchor?.isConnected) {
      const placed = document.createElement('div');
      placed.setAttribute('data-find-omit', '');
      placed.setAttribute('data-selection-ignore', '');
      anchor.after(placed);
      setHolder(placed);
      return () => placed.remove();
    }
    setHolder(document.querySelector<HTMLElement>(`[data-rewrite-slot="${turnIndex}"]`));
    return undefined;
  }, [shown, anchor, jobId, turnIndex, fileContent, editing]);

  if (!shown || !holder || !job) return null;
  return createPortal(<RewriteResultCard job={job} t={t} />, holder);
};
