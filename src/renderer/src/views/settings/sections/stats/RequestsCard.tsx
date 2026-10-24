import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { SectionCard, SectionTitle } from '../../components';
import { Radio } from 'lucide-react';
import { Figure, HelpDot, InlineStat, LegendItem, ShareBar } from './parts';
import { DOMAINS, perRun } from './aggregate';
import type { StatsAggregate, StatsScope } from './aggregate';
import { DOMAIN_COLORS, OUTCOME_COLORS } from './colors';

interface Props {
  stats: StatsAggregate;
  scope: StatsScope;
  t: (key: string) => string;
  onInspectFailures: () => void;
}

/**
 * Model requests, one level below runs: one chat run is one request, but one `/agent` run is
 * dozens and one flow is one per llm step. Under the Chat scope the card would repeat the run count
 * (1.0 per run), so it only shows where requests and runs differ. The share bar splits the
 * requests by domain under All and by outcome under one domain, so every swatch has a segment.
 */
export const RequestsCard: React.FC<Props> = ({ stats, scope, t, onInspectFailures }) => {
  // Days recorded before request counting have runs but no requests; hide the card until there is a count.
  if (stats.requestTotal === 0 || scope === 'chat') return null;
  const failed = stats.requests.failure + stats.requests.timeout;
  const byDomain = scope === 'all';
  const segments = byDomain
    ? DOMAINS.map((domain) => ({
      id: domain,
      color: DOMAIN_COLORS[domain],
      value: stats.split[domain].requests,
      label: t(`settings.stats.scope.${domain}`),
    }))
    : [
      { id: 'success', color: OUTCOME_COLORS.success, value: stats.requests.success, label: t('settings.stats.success') },
      { id: 'failed', color: OUTCOME_COLORS.failure, value: failed, label: t('settings.stats.requests.failed') },
    ];
  return (
    <SectionCard>
      <Group gap={7} align="center" mb={10} wrap="nowrap">
        <SectionTitle icon={<Radio size={15} />} label={t('settings.stats.requests')} mb={0} />
        <HelpDot hint={t('settings.stats.requests.hint')} />
      </Group>
      <Stack gap={12}>
        <Figure
          value={stats.requestTotal.toLocaleString()}
          caption={
            <Group gap={16} wrap="wrap">
              <Text component="span" fz="var(--font-size-sm)" c="dimmed">
                {t('settings.stats.requests.caption')}
              </Text>
              <InlineStat
                label={t('settings.stats.requests.perRun')}
                value={perRun(stats.requestTotal, stats.runTotal)}
              />
            </Group>
          }
        />
        <ShareBar segments={segments} />
        <Group gap={2} wrap="wrap">
          {segments.map((segment) => (segment.id === 'failed' ? null : (
            <LegendItem
              key={segment.id}
              color={segment.color}
              label={segment.label}
              value={segment.value.toLocaleString()}
            />
          )))}
          <LegendItem
            color={byDomain ? undefined : OUTCOME_COLORS.failure}
            label={t('settings.stats.requests.failed')}
            value={failed.toLocaleString()}
            hint={t('settings.stats.requests.failed.hint')}
            onClick={onInspectFailures}
          />
        </Group>
      </Stack>
    </SectionCard>
  );
};
