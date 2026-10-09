import type { FlowExecutionLog, FlowExecutionResult, SkillInstance } from '../../../../shared/types';
import { stepHasOutput } from './StepCard';

const STATUS_SYMBOL: Record<string, string> = {
  completed: '✓',
  error: '✗',
  skipped: '⊘',
  running: '…',
  pending: '○',
};

function fence(text: string): string {
  const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const ticks = '`'.repeat(Math.max(3, longestRun + 1));
  return `${ticks}\n${text}\n${ticks}`;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * One log per step for the run panel and the report. A looped step keeps its latest failure so a
 * later pass's `running` cannot hide it; runs share one list, so failures reset at each run's
 * first-step `running`.
 */
export function stepLogsById(logs: FlowExecutionLog[]): Map<string, FlowExecutionLog> {
  const latest = new Map<string, FlowExecutionLog>();
  const failed = new Map<string, FlowExecutionLog>();
  for (const log of logs) {
    if (log.stepIndex === 0 && log.status === 'running') failed.clear();
    latest.set(log.stepId, log);
    if (log.error) failed.set(log.stepId, log);
  }
  for (const [stepId, log] of latest) {
    const failure = failed.get(stepId);
    if (log.error || !failure) continue;
    latest.set(stepId, { ...log, error: failure.error, displayError: failure.displayError });
  }
  return latest;
}

export function buildFlowRunMarkdown(
  flowName: string,
  steps: SkillInstance[],
  logs: FlowExecutionLog[],
  result: FlowExecutionResult | null,
  t: (k: string) => string,
): string {
  const title = flowName.trim() || t('flow.flowName');
  const stepsWord = t('flow.steps').toLowerCase();
  const byStep = stepLogsById(logs);
  const completed = steps.filter((step) => byStep.get(step.id)?.status === 'completed').length;

  const time = formatTimestamp(result?.completedAt) || formatTimestamp(logs[logs.length - 1]?.timestamp);
  const successMark = result ? (result.success ? '✓' : '✗') : '';
  const summary = [
    t('flow.export.result.run'),
    time,
    '·',
    `${successMark} ${completed}/${steps.length} ${stepsWord}`.trim(),
  ].filter(Boolean).join(' ');

  const lines: string[] = [`# ${title}`, '', summary, ''];

  // A run the user stopped did not fail: its `error` is the engine's own marker, not a reason.
  if (result?.aborted) {
    lines.push(`_${t('flow.execution.note.aborted')}_`, '');
  } else if (result && !result.success && result.error) {
    lines.push(`**${t('flow.export.result.error')}:** ${result.error}`, '');
  }

  steps.forEach((step, index) => {
    const log = byStep.get(step.id);
    const status = log?.status ?? 'pending';
    const symbol = STATUS_SYMBOL[status] ?? '';
    const token = stepHasOutput(step) ? ` · \`{{${step.outputKey}}}\`` : '';
    lines.push(`## ${index + 1}. ${step.label} · ${step.type} · ${symbol}${token}`);

    if (!log) {
      lines.push(t('flow.export.result.notRun'), '');
    } else if (status === 'skipped') {
      lines.push(`_${t(log.note ? `flow.execution.note.${log.note}` : 'flow.export.result.skipped')}_`, '');
    } else if (log.error) {
      lines.push(`**${t('flow.export.result.error')}:**`, '', fence(log.error), '');
    } else if (log.output) {
      lines.push(fence(log.output), '');
    } else {
      lines.push(`_${t('flow.export.result.noOutput')}_`, '');
    }
  });

  return `${lines.join('\n').trimEnd()}\n`;
}
