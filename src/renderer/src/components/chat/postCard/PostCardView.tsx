import React, { Suspense } from 'react';
import { Badge, Box, Group, Text } from '@mantine/core';
import { pttRegionCode } from '../../../../../shared/linkSites/pttRegions';
import { formatPostTime, type PostCard } from '../../../../../shared/postCard';
import { fillTemplate as fill } from '../../../../../shared/fillTemplate';

// 31 KB of flags, wanted only when an article says where it came from.
const RegionFlag = React.lazy(() => import('./RegionFlag'));

const NUMERIC: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

function Tally({ tag, count, color }: { tag: string; count: number; color: string }): React.ReactElement {
  return (
    <Group gap={4} wrap="nowrap">
      <Text component="span" fz="var(--font-size-sm)" fw={600} c={color}>{tag}</Text>
      <Text component="span" fz="var(--font-size-sm)" c="var(--text-secondary)" style={NUMERIC}>{count}</Text>
    </Group>
  );
}

/**
 * A forwarded forum article's header (a PTT article) as a card: its board, its title, who wrote
 * it, when and from where, and how the pushes went. The answer's opening block says the same in
 * words; the turn hides that block while the card stands for it.
 */
export function PostCardView({ card, t }: { card: PostCard; t: (key: string) => string }): React.ReactElement {
  const time = formatPostTime(card.at);
  const code = pttRegionCode(card.from);
  const byline: React.ReactNode[] = [
    card.name
      ? (
        <Group key="who" gap={6} wrap="nowrap">
          <Text component="span" fz="inherit" c="var(--text-secondary)">{card.name}</Text>
          <Text component="span" fz="inherit">{card.author}</Text>
        </Group>
      )
      : <Text key="who" component="span" fz="inherit" c="var(--text-secondary)">{card.author}</Text>,
    time ? <Text key="time" component="span" fz="inherit" style={NUMERIC}>{time}</Text> : null,
    card.from
      ? (
        <Group key="from" gap={6} wrap="nowrap">
          {code && <Suspense fallback={null}><RegionFlag code={code} /></Suspense>}
          <Text component="span" fz="inherit">{card.from}</Text>
        </Group>
      )
      : null,
  ].filter(Boolean);

  return (
    <Box
      data-find-scope
      mb={12}
      px={14}
      py={12}
      style={{ border: '1px solid var(--border)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--bg-secondary)' }}
    >
      {card.board && (
        <Badge variant="light" size="sm" mb={6}>{fill(t('ptt.board'), { board: card.board })}</Badge>
      )}
      {card.title && (
        <Text fz="1.1em" fw={600} lh={1.4} c="var(--text-primary)">{card.title}</Text>
      )}
      <Group gap={8} mt={4} fz="var(--font-size-sm)" c="var(--text-muted)" wrap="wrap">
        {byline.map((part, index) => (
          <React.Fragment key={index}>
            {index > 0 && <Text component="span" fz="inherit" aria-hidden>·</Text>}
            {part}
          </React.Fragment>
        ))}
      </Group>
      <Group gap={14} mt={8}>
        <Tally tag={t('ptt.push')} count={card.push} color="var(--mantine-color-success)" />
        <Tally tag={t('ptt.boo')} count={card.boo} color="var(--mantine-color-error)" />
        <Tally tag={t('ptt.arrow')} count={card.arrow} color="var(--text-muted)" />
      </Group>
    </Box>
  );
}
