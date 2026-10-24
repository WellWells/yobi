import React, { useState } from 'react';
import { Box, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronRight, Workflow } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../../components';
import { EmptyState } from '../../../../../components/EmptyState';
import { OUTCOME_COLORS } from '../colors';
import { formatShare } from '../aggregate';
import { flowSuccessRate, formatDuration } from './aggregate';
import type { FlowRow, FlowStatsAggregate, StepRow } from './aggregate';
import { useStepLabelParts } from './stepLabel';
import { fillTemplate } from '../../../../../../../shared/fillTemplate';
import classes from '../stats.module.css';

interface Props {
  stats: FlowStatsAggregate;
  t: (key: string) => string;
  onInspect: () => void;
}

/** The flow row's chevron and the gap after it; expanded step names start where the flow name does. */
const CHEVRON_SIZE = 14;
const CHEVRON_GAP = 7;

/** One step inside an expanded flow. Steps that never ran in the range are not listed at all. */
const StepLine: React.FC<{ row: StepRow; t: (key: string) => string; onInspect: () => void }> = ({
  row, t, onInspect,
}) => {
  const { title, skill } = useStepLabelParts(row.label, row.type, t);
  return (
  <UnstyledButton
    onClick={onInspect}
    w="100%"
    px={6}
    py={7}
    className={classes.legendAction}
    style={{ borderRadius: 'var(--radius)', display: 'block' }}
  >
    <Group justify="space-between" gap={12} wrap="nowrap">
      <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text
          fz="var(--font-size-sm)"
          fw={row.failures > 0 ? 600 : 400}
          c={row.failures > 0 ? 'var(--mantine-color-text)' : 'dimmed'}
          truncate
        >
          {title}
        </Text>
        {skill && (
          <Text fz="var(--font-size-sm)" c="dimmed" truncate>{skill}</Text>
        )}
      </Group>
      <Group gap={12} wrap="nowrap" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {row.reason && (
          <Text fz="var(--font-size-sm)" c="dimmed">
            {t(`settings.stats.flow.reason.${row.reason}`)}
          </Text>
        )}
        {row.soft > 0 && (
          <Text fz="var(--font-size-sm)" fw={600} c={OUTCOME_COLORS.timeout}>
            {`${t('settings.stats.flow.soft')} ${row.soft.toLocaleString()}`}
          </Text>
        )}
        {row.hard > 0 && (
          <Text fz="var(--font-size-sm)" fw={600} c={OUTCOME_COLORS.failure}>
            {`${t('settings.stats.flow.hard')} ${row.hard.toLocaleString()}`}
          </Text>
        )}
        <Text fz="var(--font-size-sm)" c="dimmed" style={{ minWidth: 88, textAlign: 'right' }}>
          {/* A step that finishes inside a millisecond has no duration worth printing. */}
          {row.avgMs > 0
            ? `${row.runs.toLocaleString()} × ${formatDuration(row.avgMs)}`
            : `${row.runs.toLocaleString()} ×`}
        </Text>
      </Group>
    </Group>
  </UnstyledButton>
  );
};

/** One flow and, expanded, its steps. */
export const FlowLine: React.FC<{
  row: FlowRow;
  opened: boolean;
  onToggle: () => void;
  t: (key: string) => string;
  onInspect: () => void;
}> = ({ row, opened, onToggle, t, onInspect }) => (
  <Stack gap={0} py={8} className={classes.keyRow}>
    <UnstyledButton
      onClick={onToggle}
      aria-expanded={opened}
      w="100%"
      px={6}
      py={4}
      className={classes.legendAction}
      style={{ borderRadius: 'var(--radius)', display: 'block' }}
    >
      <Group justify="space-between" gap={12} wrap="nowrap">
        <Group gap={CHEVRON_GAP} wrap="nowrap" style={{ minWidth: 0 }}>
          <Box
            c="dimmed"
            style={{
              display: 'flex',
              flexShrink: 0,
              transform: opened ? 'rotate(90deg)' : undefined,
              transition: 'transform 0.15s ease',
            }}
          >
            <ChevronRight size={CHEVRON_SIZE} />
          </Box>
          <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-text)" truncate>
            {row.name}
          </Text>
          {row.degraded > 0 && (
            <Text fz="var(--font-size-sm)" c={OUTCOME_COLORS.timeout} style={{ flexShrink: 0 }}>
              {`${t('settings.stats.flow.degraded')} ${row.degraded.toLocaleString()}`}
            </Text>
          )}
        </Group>
        <Group gap={12} wrap="nowrap" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          <Text fz="var(--font-size-sm)" c="dimmed">
            {`${row.runTotal.toLocaleString()} ${t('settings.stats.runs.caption')}`}
          </Text>
          <Text
            fz="var(--font-size-sm)"
            fw={600}
            c={row.failures > 0 ? OUTCOME_COLORS.timeout : 'dimmed'}
          >
            {/* Step failures, not failed runs: a loop step can fail on several items of one run. */}
            {row.failures > 0
              ? fillTemplate(t('settings.stats.flow.stepFailures'), { count: row.failures.toLocaleString() })
              : t('settings.stats.flow.clean')}
          </Text>
          <Group gap={5} wrap="nowrap" align="baseline">
            <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.stats.successRate')}</Text>
            <Text
              fz="var(--font-size-md)"
              fw={600}
              c={row.runs.success === row.runTotal ? OUTCOME_COLORS.success : 'var(--mantine-color-text)'}
              style={{ minWidth: 44, textAlign: 'right' }}
            >
              {formatShare(row.runs.success, row.runTotal)}
            </Text>
          </Group>
        </Group>
      </Group>
    </UnstyledButton>

    <Collapse expanded={opened}>
      <Box pl={CHEVRON_SIZE + CHEVRON_GAP} pt={4}>
        {row.steps.map((step) => (
          <StepLine key={step.stepId} row={step} t={t} onInspect={onInspect} />
        ))}
      </Box>
    </Collapse>

    <Box
      h={3}
      mt={6}
      mx={6}
      bg="var(--mantine-color-bg-tertiary)"
      style={{ borderRadius: 2, overflow: 'hidden' }}
    >
      <Box
        h={3}
        w={`${Math.max(flowSuccessRate(row) * 100, row.runTotal > 0 ? 1 : 0)}%`}
        bg={row.runs.success === row.runTotal ? OUTCOME_COLORS.success : OUTCOME_COLORS.timeout}
      />
    </Box>
  </Stack>
);

export const FlowHealthCard: React.FC<Props> = ({ stats, t, onInspect }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <SectionCard>
      <SectionTitle icon={<Workflow size={15} />} label={t('settings.stats.flow.health.title')} />
      {stats.flows.length > 0 ? (
        <Box>
          {stats.flows.map((row) => (
            <FlowLine
              key={row.flowId}
              row={row}
              opened={openId === row.flowId}
              onToggle={() => setOpenId((current) => (current === row.flowId ? null : row.flowId))}
              t={t}
              onInspect={onInspect}
            />
          ))}
        </Box>
      ) : (
        <EmptyState icon={Workflow} label={t('settings.stats.flow.health.empty')} />
      )}
    </SectionCard>
  );
};
