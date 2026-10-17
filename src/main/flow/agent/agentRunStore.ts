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
    ...(state.conversationPath ? { conversationPath: state.conversationPath } : {}),
    status: state.status,
    turns: state.turns.length,
    updatedAt: state.updatedAt,
  };
}

/**
 * Whether a Telegram/LINE message started this run. `botScope` and `botGrants` are written on every
 * bot run, and `connectors: 'none'` only ever by the bot grants; any one of them is enough. Such a
 * run continues only through the bot, which re-reads the account's rights: the desktop resumes with
 * its own full tool kit and the owner's memory, so it must neither offer nor resume one.
 */
export function isBotRun(state: AgentRunState): boolean {
  return state.botScope !== undefined || state.botGrants !== undefined || state.connectors === 'none';
}

export function shouldOfferOnRestart(state: AgentRunState): boolean {
  if (isBotRun(state)) return false;
  return state.status === 'running' || state.status === 'failed';
}

function isPendingAsk(turn: AgentTurnRecord): boolean {
  return turn.tool === AGENT_ASK_TOOL && turn.observation === '';
}

/**
 * A bot user answers a numbered question with "2". The model would have to line that up with a list
 * it may no longer see, so the pick is spelled out next to the number the user sent.
 */
function expandChoice(turn: AgentTurnRecord, answer: string): string {
  const picked = /^\s*(\d{1,2})\s*[.)。]?\s*$/.exec(answer);
  if (!picked || !turn.config.choices) return answer;
  try {
    const choices: unknown = JSON.parse(turn.config.choices);
    const choice = Array.isArray(choices) ? choices[Number(picked[1]) - 1] : undefined;
    return typeof choice === 'string' ? `${picked[1]}. ${choice}` : answer;
  } catch {
    return answer;
  }
}

export function applyAnswer(turns: AgentTurnRecord[], answer: string): AgentTurnRecord[] {
  const index = turns.findIndex(isPendingAsk);
  if (index < 0) return turns.slice();
  const next = turns.slice();
  next[index] = { ...next[index], observation: expandChoice(next[index], answer) };
  return next;
}

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

/** The connectors a run disclosed, trimmed and without blanks or duplicates. */
export function readRunConnectors(state: AgentRunState): string[] {
  return [...new Set((state.mcpServerIds ?? []).map((id) => id.trim()).filter(Boolean))];
}

/** Normalises a loaded run's connector list so nothing downstream sees blanks or duplicates. */
function normalizeRunState(state: AgentRunState): AgentRunState {
  const ids = readRunConnectors(state);
  const { mcpServerIds: _stored, ...rest } = state;
  return { ...rest, ...(ids.length > 0 ? { mcpServerIds: ids } : {}) };
}

/**
 * In-place writeFile that serializes after the await, unlike atomicWrite: a call_tools batch saves
 * one state object several times in a tick, and late serialization makes those overlapping writes
 * identical. Temp+rename would need a per-file queue, since concurrent renames fail with EPERM on
 * Windows.
 */
export async function saveRunState(state: AgentRunState): Promise<void> {
  await fs.mkdir(runsDir(), { recursive: true });
  await fs.writeFile(runFile(state.runId), JSON.stringify(state), 'utf-8');
}

export async function loadRunState(runId: string): Promise<AgentRunState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(runFile(runId), 'utf-8'));
    return isRunState(parsed) ? normalizeRunState(parsed) : null;
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
      if (isRunState(parsed)) states.push(normalizeRunState(parsed));
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

/** Runs are reclaimed by age only; finished runs are kept too, so their record can be checked. */
export async function pruneOldRuns(nowMs: number): Promise<void> {
  const states = await readAllStates().catch(() => []);
  for (const state of states) {
    if (isStale(state, nowMs)) await deleteRunState(state.runId).catch(() => {});
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
