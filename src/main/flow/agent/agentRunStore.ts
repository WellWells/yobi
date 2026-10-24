import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { AGENT_ASK_TOOL } from '../../../shared/types';
import type { AgentRunState, AgentRunSummary, AgentTurnRecord } from '../../../shared/types';
import { writeFileAtomic } from '../../atomicWrite';
import { conversationPathKey } from '../../conversationPaths';
import { resolveConversationPath } from '../../conversationIndex';

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

/** How the question being answered was shown to the user. */
export interface AskShown {
  /**
   * Its choices were listed with numbers (the text form: LINE, the desktop chat, a bot message
   * without buttons), so a typed "2" means the second. Buttons show no numbers: there a typed "2"
   * stays "2", and so never approves anything.
   */
  numbered: boolean;
}

function readAskChoices(turn: AgentTurnRecord): string[] {
  try {
    const choices: unknown = JSON.parse(turn.config.choices ?? '[]');
    return Array.isArray(choices) ? choices.filter((choice): choice is string => typeof choice === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Said with a bare number typed under buttons. Review 2026-10-20: left as "1" beside the ordered
 * choices the run had saved, the model read it as the first choice — the very pick the user could
 * not have meant, since the buttons showed no numbers.
 */
const UNNUMBERED_PICK_NOTE = '(typed; the choices were shown as buttons without numbers, so this number picks none of them)';

/**
 * A user answers a numbered question with "2". The model would have to line that up with a list
 * it may no longer see, so the pick is spelled out next to the number the user sent. An answer that
 * is a choice word for word (a pressed button or chip, even one reading "2") stays that choice.
 * Under buttons the number is kept as typed, with a note that it picks none of them.
 */
function expandChoice(turn: AgentTurnRecord, answer: string, shown: AskShown): string {
  const picked = /^\s*(\d{1,2})\s*[.)。]?\s*$/.exec(answer);
  if (!picked) return answer;
  const choices = readAskChoices(turn);
  if (choices.includes(answer.trim())) return answer;
  if (!shown.numbered) return choices.length > 0 ? `${answer.trim()} ${UNNUMBERED_PICK_NOTE}` : answer;
  const choice = choices[Number(picked[1]) - 1];
  return choice === undefined ? answer : `${picked[1]}. ${choice}`;
}

/** `shown` omitted = the text form, whose choices are numbered. */
export function applyAnswer(turns: AgentTurnRecord[], answer: string, shown: AskShown = { numbered: true }): AgentTurnRecord[] {
  const index = turns.findIndex(isPendingAsk);
  if (index < 0) return turns.slice();
  const next = turns.slice();
  next[index] = { ...next[index], observation: expandChoice(next[index], answer, shown) };
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
  const offered = states.filter(shouldOfferOnRestart);
  // "Continue" reopens the conversation: one moved outside Yobi is found again by its id.
  for (const state of offered) {
    if (!state.conversationPath) continue;
    const found = await resolveConversationPath({ path: state.conversationPath, id: state.conversationId });
    if (found) state.conversationPath = found;
  }
  return offered
    .map(toSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The conversations a run is waiting in for the user's answer — after a restart too. The answer
 * is written there, so such a conversation is not moved. A stale run is never offered again.
 */
export async function awaitingRunConversations(nowMs: number): Promise<string[]> {
  const states = await readAllStates().catch((): AgentRunState[] => []);
  return states
    .filter((state) => state.status === 'awaiting' && !isStale(state, nowMs))
    .map((state) => state.conversationPath ?? '')
    .filter(Boolean);
}

/**
 * Points the saved runs of conversations that were just moved at the files' new place, so an
 * answer, "Continue" and the trace still find them. A run in progress is skipped: it saves its own
 * state in place, and a conversation with one is never moved.
 */
export async function repointRunConversations(
  moves: ReadonlyArray<{ from: string; to: string; id?: string }>,
): Promise<number> {
  if (moves.length === 0) return 0;
  const byOldPath = new Map(moves.map((move) => [conversationPathKey(move.from), move]));
  const states = await readAllStates().catch((): AgentRunState[] => []);
  let changed = 0;
  for (const state of states) {
    if (!state.conversationPath || activeRuns.has(state.runId)) continue;
    const move = byOldPath.get(conversationPathKey(state.conversationPath));
    if (!move) continue;
    const id = move.id ?? state.conversationId;
    const next: AgentRunState = { ...state, conversationPath: move.to, ...(id ? { conversationId: id } : {}) };
    try {
      await writeFileAtomic(runFile(state.runId), JSON.stringify(next));
      changed += 1;
    } catch {
      // The run keeps its old path; its id still finds the file when it is read.
    }
  }
  return changed;
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
