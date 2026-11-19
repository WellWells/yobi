import React, { useEffect, useState } from 'react';
import { Loader, Stack, Text } from '@mantine/core';
import { knowledgeApi } from '../../api/electronApi';
import { summaryPreview } from './knowledgeFileRows';

/** Read summaries, per base, file and summary version; a new summary (`ai.at`) is a new key. */
const previews = new Map<string, string>();
const PREVIEWS_KEPT = 200;

function remember(key: string, text: string): void {
  if (previews.size >= PREVIEWS_KEPT) previews.delete(previews.keys().next().value ?? '');
  previews.set(key, text);
}

interface KnowledgeSummaryHintProps {
  kbId: string;
  path: string;
  /** The summary's version (`file.ai.at`). */
  at: number;
  /** Shown under the summary: it was written before the file last changed. */
  staleNote?: string;
  emptyLabel: string;
}

/**
 * A summary row's tooltip: the summary itself. Mounted only while the tooltip is open, so the
 * summary is read from the index on the first hover, not for every row in the list.
 */
export function KnowledgeSummaryHint({ kbId, path, at, staleNote, emptyLabel }: KnowledgeSummaryHintProps): React.ReactElement {
  const key = `${kbId}\n${path}\n${at}`;
  const [text, setText] = useState(() => previews.get(key));

  useEffect(() => {
    const known = previews.get(key);
    setText(known);
    if (known !== undefined) return undefined;
    let live = true;
    void knowledgeApi.fileDetail(kbId, path).then((detail) => {
      const preview = summaryPreview(detail?.ai ?? '');
      remember(key, preview);
      if (live) setText(preview);
    }, () => undefined);
    return () => { live = false; };
  }, [key, kbId, path]);

  return (
    <Stack gap={6}>
      {text === undefined ? <Loader size={12} color="currentColor" /> : <Text fz="inherit">{text || emptyLabel}</Text>}
      {/* Same colour as the summary: the tooltip's inverted background has no contrast for the status tokens. */}
      {staleNote && <Text fz="inherit" fw={600}>{staleNote}</Text>}
    </Stack>
  );
}
