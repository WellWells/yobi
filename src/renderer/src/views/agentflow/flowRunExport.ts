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

function latestLog(logs: FlowExecutionLog[], stepId: string): FlowExecutionLog | undefined {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    if (logs[i].stepId === stepId) return logs[i];
  }
  return undefined;
}

export function buildFlowRunMarkdown(
  flowName: string,
  steps: SkillInstance[],
  logs: FlowExecutionLog[],
  result: FlowExecutionResult | null,
  t: (k: string) => string,
): string {
  const title = flowName.trim() || t('agentflow.flowName');
  const stepsWord = t('agentflow.steps').toLowerCase();
  const completed = steps.filter((step) => latestLog(logs, step.id)?.status === 'completed').length;

  const time = formatTimestamp(result?.completedAt) || formatTimestamp(logs[logs.length - 1]?.timestamp);
  const successMark = result ? (result.success ? '✓' : '✗') : '';
  const summary = [
    t('agentflow.export.result.run'),
    time,
    '·',
    `${successMark} ${completed}/${steps.length} ${stepsWord}`.trim(),
  ].filter(Boolean).join(' ');

  const lines: string[] = [`# ${title}`, '', summary, ''];

  if (result && !result.success && result.error) {
    lines.push(`**${t('agentflow.export.result.error')}:** ${result.error}`, '');
  }

  steps.forEach((step, index) => {
    const log = latestLog(logs, step.id);
    const status = log?.status ?? 'pending';
    const symbol = STATUS_SYMBOL[status] ?? '';
    const token = stepHasOutput(step) ? ` · \`{{${step.outputKey}}}\`` : '';
    lines.push(`## ${index + 1}. ${step.label} · ${step.type} · ${symbol}${token}`);

    if (!log) {
      lines.push(t('agentflow.export.result.notRun'), '');
    } else if (status === 'skipped') {
      lines.push(`_${t('agentflow.export.result.skipped')}_`, '');
    } else if (log.error) {
      lines.push(`**${t('agentflow.export.result.error')}:**`, '', fence(log.error), '');
    } else if (log.output) {
      lines.push(fence(log.output), '');
    } else {
      lines.push(`_${t('agentflow.export.result.noOutput')}_`, '');
    }
  });

  return `${lines.join('\n').trimEnd()}\n`;
}
