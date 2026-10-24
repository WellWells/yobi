import React, { useMemo } from 'react';
import { Group, Stack, Text, VisuallyHidden } from '@mantine/core';
import { diffLines, diffRows } from '../../../../shared/lineDiff';
import type { DiffRow } from '../../../../shared/lineDiff';
import { diffText } from '../../utils/textDiff';
import type { DiffPart } from '../../utils/textDiff';
import { fillTemplate } from '../../../../shared/fillTemplate';

const WASH = {
  removed: 'color-mix(in srgb, var(--mantine-color-error) 10%, transparent)',
  added: 'color-mix(in srgb, var(--mantine-color-success) 12%, transparent)',
} as const;

const MARK = {
  removed: {
    background: 'color-mix(in srgb, var(--mantine-color-error) 24%, transparent)',
    textDecoration: 'line-through',
    textDecorationColor: 'var(--mantine-color-error)',
    borderRadius: 3,
  },
  added: {
    background: 'color-mix(in srgb, var(--mantine-color-success) 28%, transparent)',
    // <ins> is underlined by default; the wash already marks it.
    textDecoration: 'none',
    borderRadius: 3,
  },
} as const;

const LINE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-reading)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  lineHeight: 1.6,
  minHeight: '1.6em',
};

/** The element that says "removed" or "added" to assistive tech, not only by colour. */
const MARK_ELEMENT = { removed: 'del', added: 'ins' } as const;

/**
 * One side of a changed line, with what only that side has marked. The −/+ glyph is for the eye;
 * a screen reader hears `label` before the line instead.
 */
const Side: React.FC<{ side: 'removed' | 'added'; text: string; parts: DiffPart[] | null; label: string }> = ({ side, text, parts, label }) => (
  <Group gap={8} wrap="nowrap" align="flex-start" px={8} bg={WASH[side]}>
    <Text component="div" fz="var(--font-size-sm)" c="var(--text-muted)" w={10} style={{ flexShrink: 0, lineHeight: 1.6 }} aria-hidden>
      {side === 'removed' ? '−' : '+'}
    </Text>
    <Text component="div" fz="var(--font-size-sm)" c={side === 'removed' ? 'var(--text-secondary)' : 'var(--text-primary)'} style={LINE_STYLE}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {parts
        ? parts.map((part, index) => {
          if (part.kind === 'same') return <React.Fragment key={index}>{part.text}</React.Fragment>;
          if (part.kind !== side) return null;
          return <Text key={index} component={MARK_ELEMENT[side]} inherit style={MARK[side]}>{part.text}</Text>;
        })
        : text}
    </Text>
  </Group>
);

function Row({ row, foldText, t }: { row: DiffRow; foldText: (count: number) => string; t: (key: string) => string }) {
  if (row.kind === 'fold') {
    return (
      <Text fz="var(--font-size-xs)" c="var(--text-muted)" px={26} py={4} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {foldText(row.count)}
      </Text>
    );
  }
  if (row.kind === 'same') {
    return (
      <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)" pl={26} pr={8} style={LINE_STYLE}>
        {row.text}
      </Text>
    );
  }
  // Both sides of a replaced line are compared word by word; a lone line is shown whole.
  const parts = row.before !== null && row.after !== null ? diffText(row.before, row.after) : null;
  return (
    <>
      {row.before !== null && <Side side="removed" text={row.before} parts={parts} label={t('history.diff.removed')} />}
      {row.after !== null && <Side side="added" text={row.after} parts={parts} label={t('history.diff.added')} />}
    </>
  );
}

export interface TextDiffViewProps {
  before: string;
  after: string;
  t: (key: string) => string;
}

/**
 * Two versions of a text, line by line: lines only `before` has struck through in red, lines only
 * `after` has in green, the words that changed inside a replaced line marked again. Long runs of
 * unchanged lines fold into a count; a diff too large to compute says so instead.
 */
export const TextDiffView: React.FC<TextDiffViewProps> = ({ before, after, t }) => {
  const rows = useMemo(() => {
    const ops = diffLines(before, after);
    return ops ? diffRows(ops) : null;
  }, [before, after]);

  if (rows === null) {
    return <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('history.diff.tooLarge')}</Text>;
  }
  if (!rows.some((row) => row.kind === 'change')) {
    return <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('history.diff.none')}</Text>;
  }
  return (
    <Stack gap={0}>
      {rows.map((row, index) => (
        <Row key={index} row={row} t={t} foldText={(count) => fillTemplate(t('history.diff.folded'), { count: String(count) })} />
      ))}
    </Stack>
  );
};
