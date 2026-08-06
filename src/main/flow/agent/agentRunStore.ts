import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { AGENT_ASK_TOOL } from '../../../shared/types';
import type { AgentRunState, AgentRunSummary, AgentTurnRecord } from '../../../shared/types';

const RUNS_DIRNAME = 'agent-runs';
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

function runsDir(): string {
  return path.join(app.getPath('userData'), RUNS_DIRNAME);
}

export function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'run';
}

function runFile(runId: string): string {
  return path.join(runsDir(), `${sanitizeRunId(runId)}.json`);
}

export function toSummary(state: AgentRunState): AgentRunSummary {
  return {
    runId: state.runId,
    goal: state.goal,
    status: state.status,
    turns: state.turns.length,
    updatedAt: state.updatedAt,
  };
}

/**
 * `awaiting` is deliberately absent: that run's question is already in the conversation,
 * so the user's reply is how it continues. Offering it in the resume banner as well would
 * put two competing ways to continue one run in front of them.
 */
export function shouldOfferOnRestart(state: AgentRunState): boolean {
  return state.status === 'running' || state.status === 'failed';
}

function isPendingAsk(turn: AgentTurnRecord): boolean {
  return turn.tool === AGENT_ASK_TOOL && turn.observation === '';
}

/**
 * Writes the user's reply into the question turn that is waiting for it, so the engine
 * replays the whole scratchpad — every observation already paid for, plus the answer — and
 * continues from there instead of starting the goal over.
 */
export function applyAnswer(turns: AgentTurnRecord[], answer: string): AgentTurnRecord[] {
  const index = turns.findIndex(isPendingAsk);
  if (index < 0) return turns.slice();
  const next = turns.slice();
  next[index] = { ...next[index], observation: answer };
  return next;
}

/**
 * A resume with no answer (the restart banner, a retry after a crash) must not replay an
 * unanswered question: the model would read "I asked and got nothing" and ask again.
 */
export function dropUnansweredAsk(turns: AgentTurnRecord[]): AgentTurnRecord[] {
  return turns.filter((turn) => !isPendingAsk(turn));
}

export function isStale(state: AgentRunState, nowMs: number): boolean {
  const updated = Date.parse(state.updatedAt);
  return Number.isFinite(updated) && nowMs - updated > STALE_AFTER_MS;
}

function isRunState(value: unknown): value is AgentRunState {
  return (
    typeof value === 'object' && value !== null
    && typeof (value as AgentRunState).runId === 'string'
    && Array.isArray((value as AgentRunState).turns)
  );
}

export async function saveRunState(state: AgentRunState): Promise<void> {
  await fs.mkdir(runsDir(), { recursive: true });
  await fs.writeFile(runFile(state.runId), JSON.stringify(state), 'utf-8');
}

export async function loadRunState(runId: string): Promise<AgentRunState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(runFile(runId), 'utf-8'));
    return isRunState(parsed) ? parsed : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteRunState(runId: string): Promise<void> {
  await fs.rm(runFile(runId), { force: true });
}

async function readAllStates(): Promise<AgentRunState[]> {
  let files: string[];
  try {
    files = await fs.readdir(runsDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const states: AgentRunState[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(runsDir(), file), 'utf-8'));
      if (isRunState(parsed)) states.push(parsed);
    } catch {
    }
  }
  return states;
}

export async function listResumableRuns(): Promise<AgentRunSummary[]> {
  const states = await readAllStates();
  return states
    .filter(shouldOfferOnRestart)
    .map(toSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function pruneOldRuns(nowMs: number): Promise<void> {
  const states = await readAllStates().catch(() => []);
  for (const state of states) {
    if (state.status === 'done' || isStale(state, nowMs)) {
      await deleteRunState(state.runId).catch(() => {});
    }
  }
}

const activeRuns = new Map<string, AbortController>();

export function registerRun(runId: string): AbortController {
  const existing = activeRuns.get(runId);
  if (existing && !existing.signal.aborted) return existing;
  const controller = new AbortController();
  activeRuns.set(runId, controller);
  return controller;
}

export function abortRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
}

export function unregisterRun(runId: string): void {
  activeRuns.delete(runId);
}
