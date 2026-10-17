import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { MonitorDown } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { siteLabel } from '../../../../../../shared/linkSites/rows';
import { Figure, HelpDot, InlineStat, LegendItem } from './parts';
import { formatShare } from './aggregate';
import type { StatsAggregate } from './aggregate';
import { OUTCOME_COLORS } from './colors';

interface Props {
  stats: StatsAggregate;
  t: (key: string) => string;
  onInspectFailures: () => void;
}

/** The Downloader's uses — posts forwarded or saved, videos downloaded — and how many failed, per site. */
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
            caption={
              <Group gap={16} wrap="wrap">
                <Text component="span" fz="var(--font-size-sm)" c="dimmed">
                  {t('settings.stats.downloads.caption')}
                </Text>
                {sites.map((row) => (
                  <InlineStat
                    key={row.site}
                    label={siteLabel(row.site)}
                    value={row.counts.failure > 0
                      ? t('settings.stats.downloads.siteFailed')
                        .replace('{{total}}', row.total.toLocaleString())
                        .replace('{{failed}}', row.counts.failure.toLocaleString())
                      : row.total.toLocaleString()}
                  />
                ))}
              </Group>
            }
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
      </Stack>
    </SectionCard>
  );
};
