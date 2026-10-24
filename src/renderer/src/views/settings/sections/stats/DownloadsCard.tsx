import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { MonitorDown } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { siteLabel } from '../../../../../../shared/linkSites/rows';
import { Figure, HelpDot, LegendItem, ShareBar } from './parts';
import { formatShare } from './aggregate';
import type { StatsAggregate } from './aggregate';
import { OUTCOME_COLORS } from './colors';
import classes from './stats.module.css';

interface Props {
  stats: StatsAggregate;
  t: (key: string) => string;
  onInspectFailures: () => void;
}

/**
 * The Downloader's uses — posts forwarded or saved, videos downloaded — and how many failed. The
 * sites are one row each, like the flows in Flow health: run together on one line they wrapped into
 * a paragraph of "X 13 (2 failed) Threads 13 (1 failed) …" that nobody could scan.
 */
export const DownloadsCard: React.FC<Props> = ({ stats, t, onInspectFailures }) => {
  const { success, failure } = stats.downloadTotals;
  const total = success + failure;
  if (total === 0) return null;
  const sites = Object.entries(stats.downloads)
    .map(([site, counts]) => ({ site, counts, total: counts.success + counts.failure }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);
  return (
    <SectionCard>
      <Group gap={7} align="center" mb={10} wrap="nowrap">
        <SectionTitle icon={<MonitorDown size={15} />} label={t('settings.stats.downloads')} mb={0} />
        <HelpDot hint={t('settings.stats.downloads.hint')} />
      </Group>
      <Stack gap={12}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap={16}>
          <Figure
            value={total.toLocaleString()}
            caption={t('settings.stats.downloads.caption')}
          />
          <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
            <Text
              fz="var(--font-size-3xl)"
              fw={700}
              c={failure === 0 ? OUTCOME_COLORS.success : 'var(--mantine-color-text)'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatShare(success, total)}
            </Text>
            <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.successRate')}</Text>
          </Stack>
        </Group>
        <ShareBar
          segments={[
            { id: 'success', color: OUTCOME_COLORS.success, value: success, label: t('settings.stats.success') },
            { id: 'failure', color: OUTCOME_COLORS.failure, value: failure, label: t('settings.stats.failure') },
          ]}
        />
        <Group gap={2} wrap="wrap">
          <LegendItem
            color={OUTCOME_COLORS.success}
            label={t('settings.stats.success')}
            value={success.toLocaleString()}
          />
          <LegendItem
            color={OUTCOME_COLORS.failure}
            label={t('settings.stats.failure')}
            value={failure.toLocaleString()}
            hint={t('settings.stats.downloads.failed.hint')}
            onClick={onInspectFailures}
          />
        </Group>
        <Box>
          {sites.map((row) => (
            <Group key={row.site} justify="space-between" gap={12} wrap="nowrap" px={6} py={8} className={classes.keyRow}>
              <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-text)" truncate>
                {siteLabel(row.site)}
              </Text>
              <Group gap={12} wrap="nowrap" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                <Text fz="var(--font-size-sm)" c="dimmed">
                  {`${row.total.toLocaleString()} ${t('settings.stats.downloads.caption')}`}
                </Text>
                <Text
                  fz="var(--font-size-sm)"
                  fw={600}
                  c={row.counts.failure > 0 ? OUTCOME_COLORS.failure : 'dimmed'}
                  style={{ minWidth: 56, textAlign: 'right' }}
                >
                  {`${t('settings.stats.failure')} ${row.counts.failure.toLocaleString()}`}
                </Text>
              </Group>
            </Group>
          ))}
        </Box>
      </Stack>
    </SectionCard>
  );
};
