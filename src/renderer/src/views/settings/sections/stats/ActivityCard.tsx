import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { SectionCard } from '../../components';
import { TrendBarChart } from '../../../../components/TrendBarChart';
import { Figure, InlineStat, LegendItem } from './parts';
import { OUTCOME_KEYS, formatShare } from './aggregate';
import type { StatsAggregate, StatsScope } from './aggregate';
import { OUTCOME_COLORS } from './colors';

interface Props {
  stats: StatsAggregate;
  scope: StatsScope;
  t: (key: string) => string;
  onInspectFailures: () => void;
}

export const ActivityCard: React.FC<Props> = ({ stats, scope, t, onInspectFailures }) => {
  const failed = stats.runs.failure + stats.runs.timeout;
  return (
    <SectionCard>
      <Stack gap={16}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap={16}>
          <Figure
            value={stats.runTotal.toLocaleString()}
            caption={
              <Group gap={16} wrap="wrap">
                <Text component="span" fz="var(--font-size-sm)" c="dimmed">
                  {t('settings.stats.runs.caption')}
                </Text>
                {scope === 'all' && (
                  <>
                    <InlineStat
                      label={t('settings.stats.scope.chat')}
                      value={stats.split.chat.runs.toLocaleString()}
                    />
                    <InlineStat
                      label={t('settings.stats.scope.flow')}
                      value={stats.split.flow.runs.toLocaleString()}
                    />
                  </>
                )}
              </Group>
            }
          />
          <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
            <Text
              fz="var(--font-size-3xl)"
              fw={700}
              c={failed === 0 ? OUTCOME_COLORS.success : 'var(--mantine-color-text)'}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatShare(stats.runs.success, stats.runTotal)}
            </Text>
            <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.successRate')}</Text>
          </Stack>
        </Group>

        <TrendBarChart
          labels={stats.labels}
          height={148}
          totalLabel={t('settings.stats.runs.caption')}
          series={OUTCOME_KEYS.map((key) => ({
            id: key,
            label: t(`settings.stats.${key}`),
            color: OUTCOME_COLORS[key],
            values: stats.runsByDay[key],
          }))}
        />

        <Group gap={2} wrap="wrap">
          {OUTCOME_KEYS.map((key) => (
            <LegendItem
              key={key}
              color={OUTCOME_COLORS[key]}
              label={t(`settings.stats.${key}`)}
              value={stats.runs[key].toLocaleString()}
              hint={t(`settings.stats.${key}.hint`)}
              onClick={key === 'success' ? undefined : onInspectFailures}
            />
          ))}
        </Group>
      </Stack>
    </SectionCard>
  );
};
