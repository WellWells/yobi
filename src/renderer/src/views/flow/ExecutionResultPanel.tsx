import React, { useCallback, useMemo } from 'react';
import { Box, Button, Code, CopyButton, Group, Spoiler, Stack, Text, Tooltip } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { Check, Copy, Download, RotateCcwClock } from 'lucide-react';
import { SectionCard } from '../../components/SectionCard';
import { CopyIconButton } from '../../components/CopyIconButton';
import {
  LABEL_OFFSET,
  PROGRESS_ROW_STYLE,
  ProgressMark,
  type ProgressState,
} from '../../components/ProgressMark';
import { flowApi } from '../../api/electronApi';
import { stepHasOutput } from './StepCard';
import { buildFlowRunMarkdown, stepLogsById } from './flowRunExport';
import { isCodeOutput } from './flowCapabilities';
import { useFlowStore } from '../../store/useFlowStore';
import { stepRunKey } from '../../store/flowHelpers';
import type { FlowStepStatus, SkillInstance } from '../../../../shared/types';

const MARK_BY_STATUS: Record<FlowStepStatus, ProgressState> = {
  completed: 'done',
  error: 'failed',
  running: 'active',
  skipped: 'skipped',
  pending: 'pending',
};

/** A step's mark in a run's results; a completed step with an error failed and the flow went on. */
export function stepMark(status: FlowStepStatus, flowRunning: boolean, error?: string): ProgressState {
  if (status === 'completed' && error) return 'softFailed';
  if (status === 'running' && !flowRunning) return 'pending';
  return MARK_BY_STATUS[status];
}

export interface ExecutionResultPanelProps {
  steps: SkillInstance[];
  flowName: string;
  t: (k: string) => string;
}

export const ExecutionResultPanel: React.FC<ExecutionResultPanelProps> = React.memo(({
  steps, flowName, t,
}) => {
  const executionLogs = useFlowStore((s) => s.executionLogs);
  const executionResult = useFlowStore((s) => s.executionResult);
  const flowRunning = useFlowStore((s) => s.selectedFlowId !== null && s.runningFlowIds.includes(s.selectedFlowId));
  // The steps as they ran: a step edited since says so, its output is not what it would give now.
  const snapshot = useFlowStore((s) => (s.selectedFlowId ? s.runSnapshots[s.selectedFlowId] : undefined));
  const copyLabel = t('common.copy');
  const copiedLabel = t('common.copied');
  const buildMarkdown = useCallback(
    () => buildFlowRunMarkdown(flowName, steps, executionLogs, executionResult, t),
    [flowName, steps, executionLogs, executionResult, t],
  );
  const copyAllClipboard = useClipboard({ timeout: 1000 });
  const handleCopyAll = useCallback(() => {
    copyAllClipboard.copy(buildMarkdown());
  }, [copyAllClipboard, buildMarkdown]);
  const handleSave = useCallback(() => {
    void flowApi.exportFlowResult(buildMarkdown(), flowName);
  }, [buildMarkdown, flowName]);
  const latestLogByStep = useMemo(() => stepLogsById(executionLogs), [executionLogs]);
  return (
    <SectionCard>
      <Stack gap="sm">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <RotateCcwClock size={16} />
            <Text fz="sm" fw={600}>{t('flow.execution.result')}</Text>
          </Group>
          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Button
              variant="default"
              size="compact-xs"
              c={copyAllClipboard.copied ? 'var(--mantine-color-success)' : undefined}
              onClick={handleCopyAll}
              leftSection={copyAllClipboard.copied ? <Check size={12} /> : <Copy size={12} />}
            >
              {copyAllClipboard.copied ? copiedLabel : t('flow.export.result.copyAll')}
            </Button>
            <Button
              variant="default"
              size="compact-xs"
              onClick={handleSave}
              leftSection={<Download size={12} />}
            >
              {t('flow.export.result.save')}
            </Button>
          </Group>
        </Group>
        <Stack gap="sm">
          {steps.map((step) => {
            const log = latestLogByStep.get(step.id);
            if (!log) return null;
            // A note is a signpost in the editor, not a result: it shows here only if it failed.
            if (step.type === 'comment' && !log.error) return null;
            return (
              <Box key={step.id}>
                <Box style={PROGRESS_ROW_STYLE}>
                  <ProgressMark state={stepMark(log.status, flowRunning, log.error)} />
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text fz="xs" fw={500} c={log.status === 'skipped' ? 'dimmed' : undefined}>{step.label}</Text>
                    {snapshot?.[step.id] !== undefined && snapshot[step.id] !== stepRunKey(step) && (
                      <Tooltip label={t('flow.run.changedSince.hint')} position="top">
                        <Text fz="xs" c="var(--text-muted)" data-changed-since-run="" style={{ whiteSpace: 'nowrap' }}>{t('flow.run.changedSince')}</Text>
                      </Tooltip>
                    )}
                    {stepHasOutput(step) && (
                      <CopyButton value={`{{${step.outputKey}}}`}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? copiedLabel : copyLabel} position="top">
                            <Code fz="xs" style={{ cursor: 'pointer' }} onClick={copy}>{`{{${step.outputKey}}}`}</Code>
                          </Tooltip>
                        )}
                      </CopyButton>
                    )}
                  </Group>
                </Box>
                {log.output && (
                  <Group gap={4} wrap="nowrap" align="flex-start" mt={2} pl={LABEL_OFFSET}>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Spoiler maxHeight={72} showLabel={t('common.showMore')} hideLabel={t('common.showLess')}>
                        <Text className="selectable" fz="xs" c="dimmed" ff={isCodeOutput(step.type, log.output) ? 'monospace' : undefined} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {log.output}
                        </Text>
                      </Spoiler>
                    </Box>
                    <CopyIconButton value={log.output} copyLabel={copyLabel} copiedLabel={copiedLabel} size="sm" />
                  </Group>
                )}
                {log.note && (
                  <Text fz="xs" c="dimmed" mt={2} pl={LABEL_OFFSET}>{t(`flow.execution.note.${log.note}`)}</Text>
                )}
                {log.error && (
                  <Group gap={4} wrap="nowrap" align="flex-start" mt={2} pl={LABEL_OFFSET}>
                    <Text className="selectable" fz="xs" c="var(--mantine-color-error)" style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {log.displayError ?? log.error}
                    </Text>
                    <CopyIconButton value={log.error} copyLabel={copyLabel} copiedLabel={copiedLabel} size="sm" />
                  </Group>
                )}
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </SectionCard>
  );
});
