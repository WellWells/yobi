import React from 'react';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../../components';
import { EmptyState } from '../../../../../components/EmptyState';
import { HelpDot } from '../parts';
import { OUTCOME_COLORS } from '../colors';
import { formatDuration } from './aggregate';
import type { FlowStatsAggregate, StepRow } from './aggregate';
import classes from '../stats.module.css';

/** Long enough to show a pattern, short enough that the worst offender still leads. */
const TOP_ISSUES = 6;

interface Props {
  stats: FlowStatsAggregate;
  t: (key: string) => string;
  onInspect: () => void;
}

/**
 * One line per failing step: which flow it belongs to, how often it failed out of how often it
 * ran, the one-word diagnosis, and the last thing it actually said.
 */
const IssueRow: React.FC<{ row: StepRow; t: (key: string) => string; onInspect: () => void }> = ({
  row, t, onInspect,
}) => {
  // A step keeps its skill's name until someone renames it, and printing both then reads as a
  // stutter ("RSS 訂閱源 RSS 訂閱源").
  const skill = t(`flow.skill.${row.type}`);
  return (
  <UnstyledButton
    onClick={onInspect}
    w="100%"
    px={6}
    py={10}
    className={`${classes.keyRow} ${classes.legendAction}`}
    style={{ borderRadius: 'var(--radius)', display: 'block' }}
  >
    <Stack gap={4}>
      <Group justify="space-between" gap={12} wrap="nowrap">
        <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-text)" truncate>
            {row.label}
          </Text>
          {skill !== row.label && (
            <Text fz="var(--font-size-sm)" c="dimmed" truncate>{skill}</Text>
          )}
        </Group>
        <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
          {row.reason && (
            <Text fz="var(--font-size-sm)" c="dimmed">
              {t(`settings.stats.flow.reason.${row.reason}`)}
            </Text>
          )}
          <Text
            fz="var(--font-size-md)"
            fw={600}
            c={row.hard > 0 ? OUTCOME_COLORS.failure : OUTCOME_COLORS.timeout}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {`${row.failures.toLocaleString()} / ${row.runs.toLocaleString()}`}
          </Text>
        </Group>
      </Group>

      <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text fz="var(--font-size-sm)" c="dimmed" style={{ flexShrink: 0 }}>{row.flowName}</Text>
        {row.avgMs > 0 && (
          <Text fz="var(--font-size-sm)" c="dimmed" style={{ flexShrink: 0 }}>
            {`${t('settings.stats.flow.avg')} ${formatDuration(row.avgMs)}`}
          </Text>
        )}
        {row.latest && (
          <Text fz="var(--font-size-sm)" c="dimmed" truncate style={{ opacity: 0.75 }}>
            {row.latest.message}
          </Text>
        )}
      </Group>
    </Stack>
  </UnstyledButton>
  );
};

export const StepIssuesCard: React.FC<Props> = ({ stats, t, onInspect }) => {
  const top = stats.issues.slice(0, TOP_ISSUES);
  return (
    <SectionCard>
      <Group gap={7} align="center" mb={10} wrap="nowrap">
        <SectionTitle
          icon={<TriangleAlert size={15} />}
          label={t('settings.stats.flow.issues.title')}
          mb={0}
        />
        <HelpDot hint={t('settings.stats.flow.issues.hint')} />
      </Group>

      <Group gap={16} wrap="wrap" mb={top.length > 0 ? 4 : 10}>
        <Group gap={5} wrap="nowrap">
          <Text
            fz="var(--font-size-xl)"
            fw={700}
            c={stats.totalFailures > 0 ? OUTCOME_COLORS.timeout : 'var(--mantine-color-text)'}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {stats.totalFailures.toLocaleString()}
          </Text>
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.flow.failures')}</Text>
        </Group>
        <Group gap={5} wrap="nowrap">
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.flow.degraded')}</Text>
          <Text
            fz="var(--font-size-sm)"
            fw={600}
            c="var(--mantine-color-text)"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {stats.degradedRuns.toLocaleString()}
          </Text>
          <HelpDot hint={t('settings.stats.flow.degraded.hint')} />
        </Group>
      </Group>

      {top.length > 0 ? (
        <Box>
          {top.map((row) => (
            <IssueRow key={`${row.flowId}:${row.stepId}`} row={row} t={t} onInspect={onInspect} />
          ))}
        </Box>
      ) : (
        <EmptyState icon={CheckCircle2} label={t('settings.stats.flow.issues.empty')} />
      )}
    </SectionCard>
  );
};
