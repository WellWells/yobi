import type { FlowExecutionLog, SkillInstance, SkillType } from '../../shared/types';
import type { FlowExecutorDeps, LogCallback } from './types';

const DEFAULT_STEP_TIMEOUT_MS = 60_000;
const BROWSER_STEP_TIMEOUT_MS = 300_000;
const MAX_DELAY_MS = 3_600_000;

function normalizeTimeoutMs(value: number | undefined, fallbackMs: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return fallbackMs;
  return Math.max(1_000, Math.trunc(value));
}

export function resolveDelayMs(config: Record<string, string> | undefined): number {
  return Math.min(Number(config?.delayMs) || 1_000, MAX_DELAY_MS);
}

export function resolveStepTimeoutMs(
  type: SkillType,
  deps: FlowExecutorDeps,
  config?: Record<string, string>,
): number {
  if (type === 'llm') {
    return normalizeTimeoutMs(deps.getResponseTimeoutMs?.(), DEFAULT_STEP_TIMEOUT_MS);
  }
  if (type === 'delay') {
    return resolveDelayMs(config) + 10_000;
  }
  if (type === 'browser' || type === 'rss' || type === 'scraper' || type === 'youtube' || type === 'youtube_subs' || type === 'browser_js' || type === 'file_download') {
    return BROWSER_STEP_TIMEOUT_MS;
  }
  return DEFAULT_STEP_TIMEOUT_MS;
}

export class FlowAbortError extends Error {
  constructor() {
    super('Aborted by user');
    this.name = 'FlowAbortError';
  }
}

export function withStepTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  stepType: SkillType,
  onInterrupt?: () => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      try { onInterrupt?.(); } catch {}
      work.then(undefined, () => {});
      reject(new FlowAbortError());
      return;
    }

    const timer = setTimeout(() => {
      try { onInterrupt?.(); } catch {}
      cleanupAbort();
      reject(new Error(`${stepType} step timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`));
    }, timeoutMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      try { onInterrupt?.(); } catch {}
      reject(new FlowAbortError());
    };
    const cleanupAbort = (): void => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });

    work.then(
      (value) => {
        clearTimeout(timer);
        cleanupAbort();
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        cleanupAbort();
        reject(error);
      },
    );
  });
}

// Reject as soon as `signal` aborts, without ever starting a timeout clock.
// Used to wait on the app-wide llmLane: a flow aborted while its llm step is
// still queued must bail promptly, yet queue-wait time must NOT count against
// the model response timeout (that clock only starts once the lane is held).
export function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.then(undefined, () => {}); // observe to avoid an unhandled rejection
    return Promise.reject(new FlowAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new FlowAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

export function emitLog(
  onLog: LogCallback | undefined,
  flowId: string,
  stepId: string,
  stepIndex: number,
  status: FlowExecutionLog['status'],
  output?: string,
  error?: string,
): void {
  onLog?.({
    flowId,
    stepId,
    stepIndex,
    status,
    output,
    error,
    timestamp: new Date().toISOString(),
  });
}

export class StopFlowSignal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'StopFlowSignal';
  }
}

export function execStop(config: Record<string, string>): string {
  const value = (config.value ?? '').trim();
  if (value === '' || value === '[]') {
    throw new StopFlowSignal(`Stop condition met: value is ${value === '' ? 'empty' : '[]'}`);
  }
  return value;
}

// Loop-control signals thrown by the compact break/continue skills and caught by
// the executor's loop handling (runRange catch + expandLoop). They carry no data.
export class BreakLoopSignal extends Error {
  constructor() {
    super('Break from loop');
    this.name = 'BreakLoopSignal';
  }
}

export class ContinueLoopSignal extends Error {
  constructor() {
    super('Continue to next loop item');
    this.name = 'ContinueLoopSignal';
  }
}

export function execBreak(): string {
  throw new BreakLoopSignal();
}

export function execContinue(): string {
  throw new ContinueLoopSignal();
}

export function findLoopEndIndex(steps: SkillInstance[], startIdx: number): number {
  let depth = 1;
  for (let j = startIdx + 1; j < steps.length; j++) {
    if (steps[j].type === 'loop') depth++;
    if (steps[j].type === 'end_loop') {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
  }
  return steps.length;
}

export function findIfEndIndex(steps: SkillInstance[], startIdx: number): number {
  let depth = 1;
  for (let j = startIdx + 1; j < steps.length; j++) {
    if (steps[j].type === 'if') depth++;
    if (steps[j].type === 'end_if') {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
  }
  return steps.length;
}

function isTruthyValue(value: string): boolean {
  const v = value.trim();
  return v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

export function execIf(config: Record<string, string>): string {
  const left = (config.left ?? '').trim();
  const right = (config.right ?? '').trim();
  const operator = config.operator ?? 'is_true';
  let result: boolean;
  switch (operator) {
    case 'is_true':
      result = isTruthyValue(left);
      break;
    case 'is_false':
      result = !isTruthyValue(left);
      break;
    case 'equals':
      result = left === right;
      break;
    case 'not_equals':
      result = left !== right;
      break;
    case 'contains':
      result = right !== '' && left.includes(right);
      break;
    case 'is_empty':
      result = left === '';
      break;
    default:
      result = isTruthyValue(left);
  }
  return result ? 'true' : 'false';
}
