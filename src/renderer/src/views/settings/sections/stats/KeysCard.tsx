import React, { useMemo } from 'react';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { KeyRound, Snowflake, TriangleAlert } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { formatTokenCount } from '../../../../../../shared/tokenEstimate';
import type { ByokInstanceSnapshot } from '../../../../../../shared/types';
import { HelpDot } from './parts';
import { OUTCOME_COLORS } from './colors';
import { sumCounts } from './aggregate';
import type { StatsAggregate } from './aggregate';
import classes from './stats.module.css';

interface Props {
  stats: StatsAggregate;
  instances: ByokInstanceSnapshot[];
  t: (key: string) => string;
}

interface KeyRow {
  id: string;
  name: string;
  model: string;
  requests: number;
  failures: number;
  cooldowns: number;
  tokens: number;
  share: number;
}

/**
 * Only keys that still exist are listed. Counts belonging to a deleted instance are dropped
 * rather than shown under a remembered name — the statistics are a look back at the setup as
 * it stands, not an audit trail.
 */
function buildRows(stats: StatsAggregate, instances: ByokInstanceSnapshot[]): KeyRow[] {
  const rows: KeyRow[] = [];
  let total = 0;
  for (const instance of instances) {
    const entry = stats.keys[instance.id];
    if (!entry) continue;
    const requests = sumCounts(entry.requests);
    if (requests === 0) continue;
    total += requests;
    rows.push({
      id: instance.id,
      name: instance.name,
      model: instance.model,
      requests,
      failures: entry.requests.failure + entry.requests.timeout,
      cooldowns: entry.cooldowns,
      tokens: entry.tokens.input + entry.tokens.output,
      share: 0,
    });
  }
  for (const row of rows) row.share = total > 0 ? row.requests / total : 0;
  return rows.sort((a, b) => b.requests - a.requests);
}

const Badge: React.FC<{ icon: React.ReactNode; label: string; value: number; color: string }> = ({
  icon, label, value, color,
}) => (
  <Tooltip label={label} position="top">
    <Group gap={4} wrap="nowrap" c={color} style={{ cursor: 'help' }}>
      {icon}
      <Text fz="var(--font-size-sm)" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value.toLocaleString()}
      </Text>
    </Group>
  </Tooltip>
);

export const KeysCard: React.FC<Props> = ({ stats, instances, t }) => {
  const rows = useMemo(() => buildRows(stats, instances), [stats, instances]);
  if (rows.length === 0) return null;

  return (
    <SectionCard>
      <Group gap={7} align="center" mb={10} wrap="nowrap">
        <SectionTitle icon={<KeyRound size={15} />} label={t('settings.stats.keys')} mb={0} />
        <HelpDot hint={t('settings.stats.keys.hint')} />
      </Group>
      <Box>
        {rows.map((row) => (
          <Stack key={row.id} gap={6} py={10} className={classes.keyRow}>
            <Group justify="space-between" gap={12} wrap="nowrap">
              <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
                <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-text)" truncate>
                  {row.name}
                </Text>
                <Text fz="var(--font-size-sm)" c="dimmed" truncate>{row.model}</Text>
              </Group>
              <Group gap={14} wrap="nowrap" style={{ flexShrink: 0 }}>
                {row.cooldowns > 0 && (
                  <Badge
                    icon={<Snowflake size={13} />}
                    label={t('settings.stats.keys.cooldowns')}
                    value={row.cooldowns}
                    color={OUTCOME_COLORS.timeout}
                  />
                )}
                {row.failures > 0 && (
                  <Badge
                    icon={<TriangleAlert size={13} />}
                    label={t('settings.stats.keys.failures')}
                    value={row.failures}
                    color={OUTCOME_COLORS.failure}
                  />
                )}
                <Text fz="var(--font-size-sm)" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatTokenCount(row.tokens)}
                </Text>
                <Text
                  fz="var(--font-size-md)"
                  fw={600}
                  c="var(--mantine-color-accent)"
                  style={{ fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}
                >
                  {row.requests.toLocaleString()}
                </Text>
              </Group>
            </Group>
            <Box h={4} bg="var(--mantine-color-bg-tertiary)" style={{ borderRadius: 2 }}>
              <Box
                h={4}
                w={`${Math.max(row.share * 100, 1)}%`}
                bg="var(--mantine-color-accent)"
                style={{ borderRadius: 2 }}
              />
            </Box>
          </Stack>
        ))}
      </Box>
    </SectionCard>
  );
};
