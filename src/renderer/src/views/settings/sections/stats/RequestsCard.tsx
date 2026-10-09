import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { SectionCard, SectionTitle } from '../../components';
import { Radio } from 'lucide-react';
import { Figure, HelpDot, InlineStat, LegendItem } from './parts';
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
 * dozens and one flow is one per llm step.
 */
export const RequestsCard: React.FC<Props> = ({ stats, scope, t, onInspectFailures }) => {
  // Days recorded before request counting have runs but no requests; hide the card until there is a count.
  if (stats.requestTotal === 0) return null;
  const failed = stats.requests.failure + stats.requests.timeout;
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
        <Group gap={2} wrap="wrap">
          {scope === 'all' && DOMAINS.map((domain) => (
            <LegendItem
              key={domain}
              color={DOMAIN_COLORS[domain]}
              label={t(`settings.stats.scope.${domain}`)}
              value={stats.split[domain].requests.toLocaleString()}
            />
          ))}
          <LegendItem
            color={OUTCOME_COLORS.failure}
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
