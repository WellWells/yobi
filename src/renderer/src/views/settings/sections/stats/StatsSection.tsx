import React, { useCallback, useMemo, useState } from 'react';
import { Box, Group, Stack, Text, Button as MButton } from '@mantine/core';
import { Activity, ChartLine, Trash2 } from 'lucide-react';
import { SectionCard, SectionTitle, SettingRow, SettingDivider, ToggleSwitch } from '../../components';
import { AppSegmentedControl } from '../../../../components/AppSegmentedControl';
import { EmptyState } from '../../../../components/EmptyState';
import { WebDialog } from '../../../../components/WebDialog';
import { useAppStore } from '../../../../store/appStore';
import { useFlowStore } from '../../../../store/useFlowStore';
import { TAG_SETS } from '../../hooks/useSettingsNav';
import type { useMetrics } from '../../hooks/useMetrics';
import { DEFAULT_RANGE_DAYS, RANGE_DAYS, SCOPES, aggregateStats } from './aggregate';
import type { StatsScope } from './aggregate';
import { ActivityCard } from './ActivityCard';
import { RequestsCard } from './RequestsCard';
import { TokensCard } from './TokensCard';
import { KeysCard } from './KeysCard';
import { ConversationCard } from './ConversationCard';
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

  // Per-flow counters are never split by chat/flow scope — they only exist for flows.
  const flowStats = useMemo(
    () => aggregateFlowStats(flowSnapshot, flows, rangeDays),
    [flowSnapshot, flows, rangeDays],
  );
  const showFlowCards = scope !== 'chat';

  const inspectFailures = useCallback(() => openLogsFiltered(['error']), [openLogsFiltered]);

  const handleReset = useCallback(() => {
    setConfirmReset(false);
    void metrics.handleReset();
  }, [metrics]);

  const hasData = stats.runTotal > 0 || stats.requestTotal > 0
    || stats.tokens.input > 0 || stats.tokens.output > 0 || flowStats.totalRuns > 0;

  return (
    <Box display={showSection(TAG_SETS.stats, 'stats') ? 'block' : 'none'}>
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
                onClick={() => setConfirmReset(true)}
              >
                {t('settings.stats.reset')}
              </MButton>
            }
          />
        </Stack>
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
              {showFlowCards && (
                <>
                  <StepIssuesCard stats={flowStats} t={t} onInspect={inspectFailures} />
                  <FlowHealthCard stats={flowStats} t={t} onInspect={inspectFailures} />
                </>
              )}
              <RequestsCard stats={stats} scope={scope} t={t} onInspectFailures={inspectFailures} />
              <TokensCard stats={stats} t={t} />
              <KeysCard stats={stats} instances={metrics.byokInstances} t={t} />
              <ConversationCard stats={metrics.conversationTokens} t={t} />
              {snapshot?.since && (
                <Group gap={5} justify="center">
                  <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.since')}</Text>
                  <Text fz="var(--font-size-sm)" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {snapshot.since}
                  </Text>
                </Group>
              )}
            </Stack>
          ) : (
            <SectionCard>
              <EmptyState icon={ChartLine} label={t('settings.stats.empty')} busy={snapshot === null} />
            </SectionCard>
          )}
        </>
      )}

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
