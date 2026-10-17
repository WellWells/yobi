import React from 'react';
import { Group, Text, VisuallyHidden } from '@mantine/core';
import type { DiffPart } from '../../utils/textDiff';
import { READING_TEXT_STYLE } from '../../styles/readingText';

const MARK_STYLE: Record<'removed' | 'added', React.CSSProperties> = {
  removed: {
    background: 'color-mix(in srgb, var(--mantine-color-error) 16%, transparent)',
    textDecoration: 'line-through',
    textDecorationColor: 'var(--mantine-color-error)',
    borderRadius: 3,
  },
  added: {
    background: 'color-mix(in srgb, var(--mantine-color-success) 22%, transparent)',
    borderRadius: 3,
  },
};

/**
 * One side of a before/after comparison: the text that side has, with what only it has marked.
 * The rewrite card and the Notion sync preview show changes the same way.
 */
export const DiffLine: React.FC<{
  label: string;
  parts: DiffPart[];
  side: 'removed' | 'added';
  /** Read out before each marked part, so the change is not told by colour alone. */
  srLabel?: string;
}> = ({ label, parts, side, srLabel }) => (
  <Group align="flex-start" gap={10} wrap="nowrap">
    <Text component="div" fz="var(--font-size-xs)" c="var(--text-muted)" w={40} pt={4} style={{ flexShrink: 0 }}>
      {label}
    </Text>
    <Text
      component="div"
      ff={READING_TEXT_STYLE.fontFamily}
      fz={READING_TEXT_STYLE.fontSize}
      lh={1.75}
      c={side === 'removed' ? 'var(--text-secondary)' : 'var(--text-primary)'}
      style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {parts.map((part, index) => {
        if (part.kind === 'same') return <React.Fragment key={index}>{part.text}</React.Fragment>;
        if (part.kind !== side) return null;
        return (
          <React.Fragment key={index}>
            {srLabel && <VisuallyHidden>{srLabel}</VisuallyHidden>}
            <Text span inherit style={MARK_STYLE[side]}>{part.text}</Text>
          </React.Fragment>
        );
      })}
    </Text>
  </Group>
);
