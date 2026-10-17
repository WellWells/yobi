import type { FlowExecutionLog, FlowStepNote, SkillInstance, SkillType } from '../../shared/types';
import type { FlowExecutorDeps, LogCallback } from './types';
import { FlowUserError } from './userError';
import { findMatchingMarker } from '../../shared/flowBlockStructure';
import { raceAbort } from '../promiseRace';

const DEFAULT_STEP_TIMEOUT_MS = 60_000;
export const BROWSER_STEP_TIMEOUT_MS = 300_000;
const DEFAULT_LLM_TIMEOUT_MS = 120_000;
const MAX_DELAY_MS = 3_600_000;
/** A 4K video over a home connection: the download and its merge, not one HTTP request. */
export const YTDL_STEP_TIMEOUT_MS = 1_800_000;

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
    return normalizeTimeoutMs(deps.getResponseTimeoutMs?.(), DEFAULT_LLM_TIMEOUT_MS);
  }
  if (type === 'delay') {
    return resolveDelayMs(config) + 10_000;
  }
  // Several videos of a post one after another, then Gemini watching one, can outlast five minutes.
  if (type === 'youtube_download' || type === 'x_media') return YTDL_STEP_TIMEOUT_MS;
  // A file goes up a home connection: a large upload (up to Telegram's 2000 MiB) can take as long
  // as the download did, so it gets the download's time.
  if (type === 'bot' && (config?.attachment ?? '').trim()) return YTDL_STEP_TIMEOUT_MS;
  if (type === 'browser' || type === 'rss' || type === 'scraper' || type === 'research' || type === 'gmap_reviews' || type === 'youtube' || type === 'youtube_subs' || type === 'youtube_info' || type === 'x_posts' || type === 'x_thread' || type === 'x_trends' || type === 'browser_js' || type === 'file_download' || type === 'share') {
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
      const seconds = String(Math.ceil(timeoutMs / 1_000));
      reject(new FlowUserError(
        'flow.error.stepTimeout',
        { seconds },
        `${stepType} step timed out after ${seconds} seconds`,
      ));
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

export function withAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  return raceAbort(work, signal, () => new FlowAbortError());
}

export function emitLog(
  onLog: LogCallback | undefined,
  flowId: string,
  stepId: string,
  stepIndex: number,
  status: FlowExecutionLog['status'],
  output?: string,
  error?: string,
  displayError?: string,
): void {
  onLog?.({
    flowId,
    stepId,
    stepIndex,
    status,
    output,
    error,
    ...(displayError ? { displayError } : {}),
    timestamp: new Date().toISOString(),
  });
}

/** A step skipped on purpose: it carries a note code for the run panel to word, never an `error`. */
export function emitSkipNote(
  onLog: LogCallback | undefined,
  flowId: string,
  stepId: string,
  stepIndex: number,
  note: FlowStepNote,
): void {
  onLog?.({
    flowId,
    stepId,
    stepIndex,
    status: 'skipped',
    note,
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

/**
 * Where the loop/if block opened at `startIdx` ends. An unclosed block (hand-edited, imported or
 * an old save) runs to the end of the flow, so a missing closer is `steps.length`, not -1.
 */
export function findBlockEndIndex(steps: SkillInstance[], startIdx: number): number {
  const end = findMatchingMarker(steps, startIdx);
  return end < 0 ? steps.length : end;
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
