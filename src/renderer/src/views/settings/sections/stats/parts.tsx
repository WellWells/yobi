import React from 'react';
import { Box, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { CircleHelp } from 'lucide-react';
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
  color: string;
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}

/**
 * Carries the secondary numbers itself, so the chart needs no separate table repeating them.
 * Clickable when the number leads somewhere — failures lead to the log.
 */
export const LegendItem: React.FC<LegendItemProps> = ({ color, label, value, hint, onClick }) => {
  const body = (
    <Group gap={7} wrap="nowrap">
      <Box w={8} h={8} style={{ borderRadius: 2, background: color, flexShrink: 0 }} />
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
