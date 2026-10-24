import React, { useCallback, useMemo, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { ChartLine, Trash2 } from 'lucide-react';
import { SectionCard, SettingRow, ToggleSwitch } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppSegmentedControl } from '../../../../components/AppSegmentedControl';
import { EmptyState } from '../../../../components/EmptyState';
import { WebDialog } from '../../../../components/WebDialog';
import { useAppStore } from '../../../../store/appStore';
import { useFlowStore } from '../../../../store/useFlowStore';
import { TAG_SETS } from '../../hooks/useSettingsNav';
import type { useMetrics } from '../../hooks/useMetrics';
import { DEFAULT_RANGE_DAYS, RANGE_DAYS, SCOPES, aggregateStats, hasStoredStats } from './aggregate';
import type { StatsScope } from './aggregate';
import { ActivityCard } from './ActivityCard';
import { RequestsCard } from './RequestsCard';
import { TokensCard } from './TokensCard';
import { KeysCard } from './KeysCard';
import { ConversationCard } from './ConversationCard';
import { DownloadsCard } from './DownloadsCard';
import { FlowHealthCard, StepIssuesCard, aggregateFlowStats } from './flow';

type Metrics = ReturnType<typeof useMetrics>;

interface Props {
  metrics: Metrics;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'stats') => boolean;
  sectionGap: number;
}

export const StatsSection: React.FC<Props> = ({ metrics, t, showSection, sectionGap }) => {
  const { snapshot, flowSnapshot } = metrics;
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_RANGE_DAYS);
  const [scope, setScope] = useState<StatsScope>('all');
  const [confirmReset, setConfirmReset] = useState(false);
  const openLogsFiltered = useAppStore((state) => state.openLogsFiltered);
  const flows = useFlowStore((state) => state.flows);

  const stats = useMemo(
    () => aggregateStats(snapshot, rangeDays, scope),
    [snapshot, rangeDays, scope],
  );

  // Per-flow counters are never split by scope — they only exist for flows.
  const flowStats = useMemo(
    () => aggregateFlowStats(flowSnapshot, flows, rangeDays),
    [flowSnapshot, flows, rangeDays],
  );

  const inspectFailures = useCallback(() => openLogsFiltered(['error']), [openLogsFiltered]);

  // Per-flow cards: shown under All and Flows only, and they are never split by scope.
  const flowCards = (
    <>
      <FlowHealthCard stats={flowStats} t={t} onInspect={inspectFailures} />
      <StepIssuesCard stats={flowStats} t={t} onInspect={inspectFailures} />
      <DownloadsCard stats={stats} t={t} onInspectFailures={inspectFailures} />
    </>
  );

  const handleReset = useCallback(() => {
    setConfirmReset(false);
    void metrics.handleReset();
  }, [metrics]);

  const hasData = stats.runTotal > 0 || stats.requestTotal > 0
    || stats.tokens.input > 0 || stats.tokens.output > 0 || flowStats.totalRuns > 0
    || stats.downloadTotals.success + stats.downloadTotals.failure > 0;
  // The range only picks which figures are drawn; clearing is offered while anything is stored.
  const canClear = hasStoredStats(snapshot, flowSnapshot);

  // Below everything it would erase, the way the memory page puts "Clear all" after its list.
  const clearButton = (
    <Group justify="flex-end" gap={8}>
      <AppButton
        variant="outline"
        color="red"
        size="xs"
        leftSection={<Trash2 size={13} />}
        onClick={() => setConfirmReset(true)}
      >
        {t('settings.stats.reset')}
      </AppButton>
    </Group>
  );

  return (
    <Box display={showSection(TAG_SETS.stats, 'stats') ? 'block' : 'none'}>
      {/* A one-setting card is that row, with no title above it; the page title says Statistics. */}
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SettingRow
          label={t('settings.stats.enable')}
          hint={t('settings.stats.hint')}
          control={<ToggleSwitch checked={metrics.enabled} onChange={() => { void metrics.handleToggleEnabled(); }} />}
        />
      </SectionCard>

      {metrics.enabled && (
        <>
          {/* One filter bar for the whole page: what is counted, and over how long. */}
          <Group justify="space-between" align="center" wrap="wrap" gap={10} style={{ marginBottom: sectionGap }}>
            <AppSegmentedControl
              value={scope}
              onChange={(value) => setScope(value as StatsScope)}
              options={SCOPES.map((name) => ({ value: name, label: t(`settings.stats.scope.${name}`) }))}
              fullWidth={false}
              size="xs"
            />
            <AppSegmentedControl
              value={String(rangeDays)}
              onChange={(value) => setRangeDays(Number(value))}
              options={RANGE_DAYS.map((days) => ({ value: String(days), label: t(`settings.stats.range.${days}`) }))}
              fullWidth={false}
              size="xs"
            />
          </Group>

          {hasData ? (
            <Stack gap={sectionGap}>
              <ActivityCard stats={stats} scope={scope} t={t} onInspectFailures={inspectFailures} />
              {/* Under Flows the diagnosis is the point and leads; under All the overview comes
                  first and the flow-only cards follow it. */}
              {scope === 'flow' && flowCards}
              <RequestsCard stats={stats} scope={scope} t={t} onInspectFailures={inspectFailures} />
              <TokensCard stats={stats} t={t} />
              <KeysCard stats={stats} instances={metrics.byokInstances} t={t} />
              <ConversationCard stats={metrics.conversationTokens} t={t} />
              {scope === 'all' && flowCards}
              {snapshot?.since && (
                <Group gap={5} justify="center">
                  <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.since')}</Text>
                  <Text fz="var(--font-size-sm)" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {snapshot.since}
                  </Text>
                </Group>
              )}
              {clearButton}
            </Stack>
          ) : (
            <Stack gap={sectionGap}>
              <SectionCard>
                <EmptyState icon={ChartLine} label={t('settings.stats.empty')} busy={snapshot === null} />
              </SectionCard>
              {canClear && clearButton}
            </Stack>
          )}
        </>
      )}
      {/* Recording off hides the figures, but what was already counted can still be cleared. */}
      {!metrics.enabled && canClear && clearButton}

      <WebDialog
        open={confirmReset}
        danger
        title={t('settings.stats.reset.confirm.title')}
        description={t('settings.stats.reset.confirm.body')}
        confirmText={t('settings.stats.reset.confirm.submit')}
        cancelText={t('dialog.cancel')}
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </Box>
  );
};
