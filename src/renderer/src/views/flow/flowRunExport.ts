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

export interface RunSpot {
  stepId: string;
  /** The step's number as its card shows it (#N). */
  position: number;
  kind: 'failed' | 'running' | 'stopped';
}

/** "第 {{step}} 步失敗" and the like, for the band and the outline's run line. */
export const RUN_SPOT_LABEL_KEY: Record<RunSpot['kind'], string> = {
  failed: 'flow.run.failedAt',
  running: 'flow.run.runningAt',
  stopped: 'flow.run.stoppedAt',
};

/**
 * The step the editor's top band points at: the first one the last run failed on, else, while the
 * flow runs, the one it is on (the innermost: a loop stays `running` while its steps run), else
 * the stop step that ended the last run early (not a failure: the run succeeded there).
 */
export function runSpot(steps: SkillInstance[], byStep: Map<string, FlowExecutionLog>, flowRunning: boolean): RunSpot | null {
  // The step that ended the run, before one that failed but let it go on (`emitFailFlag`).
  const hardAt = steps.findIndex((step) => byStep.get(step.id)?.status === 'error');
  const failedAt = hardAt >= 0 ? hardAt : steps.findIndex((step) => byStep.get(step.id)?.error);
  if (failedAt >= 0) return { stepId: steps[failedAt].id, position: failedAt + 1, kind: 'failed' };
  if (!flowRunning) {
    const stoppedAt = steps.findIndex((step) => byStep.get(step.id)?.note === 'stopped');
    return stoppedAt >= 0 ? { stepId: steps[stoppedAt].id, position: stoppedAt + 1, kind: 'stopped' } : null;
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    if (byStep.get(steps[i].id)?.status === 'running') return { stepId: steps[i].id, position: i + 1, kind: 'running' };
  }
  return null;
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
