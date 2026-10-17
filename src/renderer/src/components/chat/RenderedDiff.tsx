import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Group, Stack, Text, VisuallyHidden } from '@mantine/core';
import { READING_TEXT_STYLE } from '../../styles/readingText';
import { changedRanges, clearDiffHighlights, setDiffHighlights, visibleText } from '../../utils/renderedDiff';
import { MessageMarkdown } from './MessageMarkdown';

interface RenderedDiffProps {
  /** Notion-flavored Markdown on each side; an empty side is not drawn. */
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  /** Read out with the changed words, so the change is not told by colour alone. */
  srRemoved: string;
  srAdded: string;
}

const Side: React.FC<{ label: string; boxRef: React.RefObject<HTMLDivElement | null>; children: string; muted?: boolean }> = ({
  label, boxRef, children, muted = false,
}) => (
  <Group align="flex-start" gap={10} wrap="nowrap">
    <Text component="div" fz="var(--font-size-xs)" c="var(--text-muted)" w={40} pt={4} style={{ flexShrink: 0 }}>
      {label}
    </Text>
    <Box
      ref={boxRef}
      className="md-content"
      style={{ ...READING_TEXT_STYLE, lineHeight: 1.7, flex: 1, minWidth: 0, color: muted ? 'var(--text-secondary)' : 'var(--text-primary)' }}
    >
      <MessageMarkdown notion>{children}</MessageMarkdown>
    </Box>
  </Group>
);

/**
 * A change shown as it will read in the document: both sides rendered as the page renders them,
 * the deleted words marked on the old side and the new words on the new side. Markdown and Notion
 * tags never appear as text here; the marks are recomputed when a code block or formula finishes
 * drawing.
 */
export const RenderedDiff: React.FC<RenderedDiffProps> = ({ before, after, beforeLabel, afterLabel, srRemoved, srAdded }) => {
  const owner = useId();
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const [spoken, setSpoken] = useState<{ removed: string; added: string }>({ removed: '', added: '' });

  useEffect(() => {
    let frame = 0;
    const mark = (): void => {
      frame = 0;
      const ranges = changedRanges(
        beforeRef.current ? visibleText(beforeRef.current) : null,
        afterRef.current ? visibleText(afterRef.current) : null,
      );
      setDiffHighlights(owner, ranges);
      const words = (list: Range[]): string => list.map((range) => range.toString().trim()).filter(Boolean).join(' … ');
      const next = { removed: words(ranges.removed), added: words(ranges.added) };
      setSpoken((prev) => (prev.removed === next.removed && prev.added === next.added ? prev : next));
    };
    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(mark);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    for (const box of [beforeRef.current, afterRef.current]) {
      if (box) observer.observe(box, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      clearDiffHighlights(owner);
    };
  }, [owner, before, after]);

  return (
    <Stack gap={6}>
      {before && <Side label={beforeLabel} boxRef={beforeRef} muted>{before}</Side>}
      {after && <Side label={afterLabel} boxRef={afterRef}>{after}</Side>}
      {spoken.removed && <VisuallyHidden>{`${srRemoved}${spoken.removed}`}</VisuallyHidden>}
      {spoken.added && <VisuallyHidden>{`${srAdded}${spoken.added}`}</VisuallyHidden>}
    </Stack>
  );
};
