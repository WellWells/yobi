import React from 'react';
import { Box, Group, Progress, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { CircleHelp } from 'lucide-react';
import { formatShare } from './aggregate';
import classes from './stats.module.css';

/** The one display-scale number on the page; everything else stays at body scale. */
export const Figure: React.FC<{ value: string; caption: React.ReactNode }> = ({ value, caption }) => (
  <Box>
    <Text
      fz={34}
      fw={700}
      lh={1.05}
      c="var(--mantine-color-text)"
      style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
    >
      {value}
    </Text>
    <Text fz="var(--font-size-sm)" c="dimmed" mt={4} lh={1.5}>
      {caption}
    </Text>
  </Box>
);

export const HelpDot: React.FC<{ hint: string }> = ({ hint }) => (
  <Tooltip label={hint} position="top" maw={300} multiline>
    <Box c="dimmed" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'help' }}>
      <CircleHelp size={13} />
    </Box>
  </Tooltip>
);

interface LegendItemProps {
  /** The swatch of the chart or share bar segment this number belongs to; none when no mark draws it. */
  color?: string;
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}

/**
 * Carries the secondary numbers itself, so the chart needs no separate table repeating them.
 * Clickable when the number leads somewhere — failures lead to the log. A swatch only appears when
 * something on the card is drawn in that colour; a dot with no chart behind it reads as a key to
 * nothing.
 */
export const LegendItem: React.FC<LegendItemProps> = ({ color, label, value, hint, onClick }) => {
  const body = (
    <Group gap={7} wrap="nowrap">
      {color && <Box w={8} h={8} style={{ borderRadius: 2, background: color, flexShrink: 0 }} />}
      <Text fz="var(--font-size-sm)" c="dimmed">{label}</Text>
      <Text
        fz="var(--font-size-sm)"
        fw={600}
        c="var(--mantine-color-text)"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Text>
    </Group>
  );
  const wrapped = onClick
    ? (
      <UnstyledButton
        onClick={onClick}
        px={6}
        py={3}
        style={{ borderRadius: 'var(--radius)' }}
        className={classes.legendAction}
      >
        {body}
      </UnstyledButton>
    )
    : <Box px={6} py={3}>{body}</Box>;
  return hint ? <Tooltip label={hint} position="top" maw={300} multiline>{wrapped}</Tooltip> : wrapped;
};

export interface ShareSegment {
  id: string;
  color: string;
  value: number;
  label: string;
}

/**
 * One bar split by share, the way the big apps draw "usage by feature": it gives a breakdown legend
 * something to point at when the card has no day-by-day chart. Empty segments are left out.
 */
export const ShareBar: React.FC<{ segments: ShareSegment[] }> = ({ segments }) => {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;
  return (
    <Progress.Root size={8} radius="sm" bg="var(--mantine-color-bg-tertiary)">
      {segments.filter((segment) => segment.value > 0).map((segment) => (
        <Progress.Section
          key={segment.id}
          value={(segment.value / total) * 100}
          color={segment.color}
          aria-label={`${segment.label} ${formatShare(segment.value, total)}`}
        />
      ))}
    </Progress.Root>
  );
};

/** A label/value pair set on one line, used for the running breakdowns under a figure. */
export const InlineStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Group gap={5} wrap="nowrap">
    <Text fz="var(--font-size-sm)" c="dimmed">{label}</Text>
    <Text
      fz="var(--font-size-sm)"
      fw={600}
      c="var(--mantine-color-text)"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {value}
    </Text>
  </Group>
);
