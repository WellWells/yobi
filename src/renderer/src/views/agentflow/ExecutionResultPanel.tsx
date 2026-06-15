import React, { useCallback, useMemo } from 'react';
import { ActionIcon, Box, Button, Code, CopyButton, Group, Spoiler, Stack, Text, Tooltip } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { Check, CheckCircle2, ClipboardCopy, Copy, Download, History, XCircle } from 'lucide-react';
import { SectionCard } from '../../components/SectionCard';
import { flowApi } from '../../api/electronApi';
import { stepHasOutput } from './StepCard';
import { buildFlowRunMarkdown } from './flowRunExport';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import type { FlowExecutionLog, SkillInstance } from '../../../../shared/types';

const CopyIconButton: React.FC<{ value: string; copyLabel: string; copiedLabel: string }> = ({
  value, copyLabel, copiedLabel,
}) => (
  <CopyButton value={value}>
    {({ copied, copy }) => (
      <Tooltip label={copied ? copiedLabel : copyLabel} position="left">
        <ActionIcon variant="subtle" size="sm" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label={copyLabel}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </ActionIcon>
      </Tooltip>
    )}
  </CopyButton>
);

export interface ExecutionResultPanelProps {
  steps: SkillInstance[];
  flowName: string;
  t: (k: string) => string;
}

export const ExecutionResultPanel: React.FC<ExecutionResultPanelProps> = React.memo(({
  steps, flowName, t,
}) => {
  const executionLogs = useAgentFlowStore((s) => s.executionLogs);
  const executionResult = useAgentFlowStore((s) => s.executionResult);
  const copyLabel = t('common.copy');
  const copiedLabel = t('common.copied');
  // Building the export markdown walks every (untruncated) step output, so it
  // is deferred to the copy/save click instead of running per log event.
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
  const latestLogByStep = useMemo(() => {
    const map = new Map<string, FlowExecutionLog>();
    for (const log of executionLogs) map.set(log.stepId, log);
    return map;
  }, [executionLogs]);
  return (
    <SectionCard>
      <Stack gap="sm">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <History size={16} />
            <Text fz="sm" fw={600}>{t('agentflow.execution.result')}</Text>
          </Group>
          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Button
              variant="default"
              size="compact-xs"
              color={copyAllClipboard.copied ? 'teal' : undefined}
              onClick={handleCopyAll}
              leftSection={copyAllClipboard.copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
            >
              {copyAllClipboard.copied ? copiedLabel : t('agentflow.export.result.copyAll')}
            </Button>
            <Button
              variant="default"
              size="compact-xs"
              onClick={handleSave}
              leftSection={<Download size={12} />}
            >
              {t('agentflow.export.result.save')}
            </Button>
          </Group>
        </Group>
        <Stack gap="sm">
          {steps.map((step) => {
            const log = latestLogByStep.get(step.id);
            if (!log) return null;
            return (
              <Box key={step.id}>
                <Group gap="xs" wrap="nowrap">
                  {log.status === 'completed' && <CheckCircle2 size={14} color="var(--mantine-color-green-6)" />}
                  {log.status === 'error' && <XCircle size={14} color="var(--mantine-color-red-6)" />}
                  <Text fz="xs" fw={500}>{step.label}</Text>
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
                {log.output && (
                  <Group gap={4} wrap="nowrap" align="flex-start" mt={2}>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Spoiler maxHeight={72} showLabel={t('common.showMore')} hideLabel={t('common.showLess')}>
                        <Text fz="xs" c="dimmed" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {log.output}
                        </Text>
                      </Spoiler>
                    </Box>
                    <CopyIconButton value={log.output} copyLabel={copyLabel} copiedLabel={copiedLabel} />
                  </Group>
                )}
                {log.error && (
                  <Group gap={4} wrap="nowrap" align="flex-start" mt={2}>
                    <Text fz="xs" c="red" style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {log.error}
                    </Text>
                    <CopyIconButton value={log.error} copyLabel={copyLabel} copiedLabel={copiedLabel} />
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
