import React, { useMemo, useState } from 'react';
import { Box, Group, SimpleGrid, Stack, Text, Tooltip, Button as MButton } from '@mantine/core';
import dayjs from 'dayjs';
import { Activity, ChartLine, CircleHelp, ListChecks, TrendingUp, Trash2 } from 'lucide-react';
import { SectionCard, GroupHeader, SectionTitle, SettingRow, SettingDivider, ToggleSwitch } from '../components';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { TrendBarChart } from '../../../components/TrendBarChart';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useMetrics } from '../hooks/useMetrics';
import type { MetricOutcome } from '../../../../../shared/types';

type Metrics = ReturnType<typeof useMetrics>;

const RANGE_DAYS = [3, 7, 14] as const;
const DEFAULT_RANGE_DAYS = 7;

const OUTCOME_KEYS = ['success', 'failure', 'timeout'] as const;

const OUTCOME_COLORS: Record<MetricOutcome, string> = {
  success: 'var(--mantine-color-teal-5)',
  failure: 'var(--mantine-color-red-5)',
  timeout: 'var(--mantine-color-orange-5)',
};

function niceAxisMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const norm = value / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

function formatShare(value: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  const raw = (value / total) * 100;
  const rounded = Math.round(raw);
  if (raw > 0 && rounded === 0) return '<1%';
  return `${rounded}%`;
}

const StatTableRow: React.FC<{
  label: string;
  hint: string;
  value: string;
  first?: boolean;
}> = ({ label, hint, value, first }) => (
  <Group
    justify="space-between"
    gap={12}
    wrap="nowrap"
    py={9}
    style={first ? undefined : { borderTop: '1px solid var(--mantine-color-default-border)' }}
  >
    <Group gap={7} wrap="nowrap">
      <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)">{label}</Text>
      <Tooltip label={hint} position="top" maw={300} multiline>
        <Box c="dimmed" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'help' }}>
          <CircleHelp size={14} />
        </Box>
      </Tooltip>
    </Group>
    <Text fz="var(--font-size-md)" fw={600} c="var(--mantine-color-accent)" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Text>
  </Group>
);

const OutcomeChartCard: React.FC<{
  outcome: MetricOutcome;
  label: string;
  sum: number;
  percent?: string;
  labels: string[];
  values: number[];
  axisMax: number;
}> = ({ outcome, label, sum, percent, labels, values, axisMax }) => (
  <SectionCard>
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap">
        <Box w={7} h={7} style={{ borderRadius: '50%', background: OUTCOME_COLORS[outcome], flexShrink: 0 }} />
        <Text fz="var(--font-size-sm)" fw={600} c={OUTCOME_COLORS[outcome]} truncate>
          {label}
        </Text>
      </Group>
      <Stack gap={0}>
        <Text fz="var(--font-size-xl)" fw={700} lh={1.15} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {sum.toLocaleString()}
        </Text>
        <Text fz="var(--font-size-sm)" fw={600} c={OUTCOME_COLORS[outcome]} style={{ fontVariantNumeric: 'tabular-nums' }}>
          {percent ?? '—'}
        </Text>
      </Stack>
      <TrendBarChart
        labels={labels}
        series={[{ id: outcome, label, color: OUTCOME_COLORS[outcome], values }]}
        height={84}
        viewWidth={150}
        axisMax={axisMax}
      />
    </Stack>
  </SectionCard>
);

interface Props {
  metrics: Metrics;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'stats') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const StatsSection: React.FC<Props> = ({ metrics, t, showSection, isSearching, sectionGap }) => {
  const { snapshot } = metrics;
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_RANGE_DAYS);

  const trend = useMemo(() => {
    const labels: string[] = [];
    const values: Record<MetricOutcome, number[]> = { success: [], failure: [], timeout: [] };
    for (let offset = rangeDays - 1; offset >= 0; offset--) {
      const day = dayjs().subtract(offset, 'day');
      labels.push(day.format('MM/DD'));
      const entry = snapshot?.daily[day.format('YYYY-MM-DD')];
      for (const key of OUTCOME_KEYS) {
        values[key].push(entry ? entry.chat[key] + entry.flow[key] : 0);
      }
    }
    const sums = Object.fromEntries(
      OUTCOME_KEYS.map((key) => [key, values[key].reduce((acc, value) => acc + value, 0)]),
    ) as Record<MetricOutcome, number>;
    const totalSum = sums.success + sums.failure + sums.timeout;
    const dailyMax = Math.max(0, ...OUTCOME_KEYS.flatMap((key) => values[key]));
    const axisMax = niceAxisMax(dailyMax);
    return { labels, values, sums, totalSum, axisMax };
  }, [snapshot, rangeDays]);

  const successRateText = formatShare(trend.sums.success, trend.totalSum) ?? '—';

  return (
    <Box display={showSection(TAG_SETS.stats, 'stats') ? 'block' : 'none'}>
      {isSearching && <GroupHeader label={t('settings.group.stats')} />}

      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<ChartLine size={15} />} label={t('settings.stats.title')} />
        <Stack gap={14}>
          <SettingRow
            icon={<Activity size={13} />}
            label={t('settings.stats.enable')}
            hint={t('settings.stats.hint')}
            control={<ToggleSwitch checked={metrics.enabled} onChange={() => { void metrics.handleToggleEnabled(); }} />}
          />
          <SettingDivider />
          <SettingRow
            icon={<Trash2 size={13} />}
            label={t('settings.stats.reset')}
            hint={t('settings.stats.reset.hint')}
            control={
              <MButton
                variant="default"
                leftSection={<Trash2 size={13} />}
                onClick={() => { void metrics.handleReset(); }}
              >
                {t('settings.stats.reset')}
              </MButton>
            }
          />
        </Stack>
      </SectionCard>

      {metrics.enabled && (
        <>
          <Group justify="space-between" align="center" wrap="nowrap" style={{ marginBottom: sectionGap }}>
            <SectionTitle icon={<TrendingUp size={15} />} label={t('settings.stats.dailyTrend')} mb={0} />
            <AppSegmentedControl
              value={String(rangeDays)}
              onChange={(value) => setRangeDays(Number(value))}
              options={RANGE_DAYS.map((days) => ({ value: String(days), label: t(`settings.stats.range.${days}`) }))}
              fullWidth={false}
              size="xs"
            />
          </Group>

          <SimpleGrid cols={3} spacing={sectionGap} style={{ marginBottom: sectionGap }}>
            {OUTCOME_KEYS.map((key) => (
              <OutcomeChartCard
                key={key}
                outcome={key}
                label={t(`settings.stats.${key}`)}
                sum={trend.sums[key]}
                percent={formatShare(trend.sums[key], trend.totalSum)}
                labels={trend.labels}
                values={trend.values[key]}
                axisMax={trend.axisMax}
              />
            ))}
          </SimpleGrid>

          <SectionCard style={{ marginBottom: sectionGap }}>
            <SectionTitle icon={<ListChecks size={15} />} label={t('settings.stats.overview')} />
            <Box>
              <StatTableRow
                first
                label={t('settings.stats.total')}
                hint={t('settings.stats.total.hint')}
                value={trend.totalSum.toLocaleString()}
              />
              {OUTCOME_KEYS.map((key) => (
                <StatTableRow
                  key={key}
                  label={t(`settings.stats.${key}`)}
                  hint={t(`settings.stats.${key}.hint`)}
                  value={trend.sums[key].toLocaleString()}
                />
              ))}
              <StatTableRow
                label={t('settings.stats.successRate')}
                hint={t('settings.stats.successRate.hint')}
                value={successRateText}
              />
            </Box>
          </SectionCard>
        </>
      )}
    </Box>
  );
};
