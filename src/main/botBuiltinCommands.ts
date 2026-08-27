import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_AGENT_ASK_TTL_MINUTES } from '../shared/types';
import type { AgentRunState, BotBuiltinCommandKey } from '../shared/types';
import { config } from './config';
import { executeAgentRun } from './chat/agentCommand';
import { runSearchCommand } from './chat/searchCommand';
import type { AgentRunOutcome } from './chat/agentCommand';
import type { SearchRunOutcome } from './chat/searchCommand';
import { getBotConversation, setBotConversation } from './botConversations';
import { applyAnswer, loadRunState } from './flow/agent/agentRunStore';
import { sendLog } from './helpers';
import { t } from './i18n';
import { getProviderLabel } from './providers';
import type { FlowManager } from './flow';

type Strings = Record<string, string>;

export type BotPlatform = 'telegram' | 'line';

export interface BotBuiltinDeps {
  getFlowManager: () => FlowManager | null;
  getStrings: () => Strings;
}

export interface BotBuiltinRunResult {
  ok: boolean;
  text: string;
  title: string;
  savedFileName: string;
  providerLabel: string;
  elapsedSeconds: string;
  awaitingAnswer: boolean;
}

interface PendingAsk {
  runId: string;
  expiresAt: number;
}

const pendingAsks = new Map<string, PendingAsk>();

export function botChatKey(platform: BotPlatform, chatId: string, userId: string): string {
  return `${platform}:${chatId}:${userId}`;
}

function askTtlMs(): number {
  const minutes = config.builtinCommands?.askTtlMinutes ?? DEFAULT_AGENT_ASK_TTL_MINUTES;
  return minutes * 60_000;
}

export function takePendingAgentAsk(chatKey: string): string | null {
  const pending = pendingAsks.get(chatKey);
  if (!pending) return null;
  pendingAsks.delete(chatKey);
  return pending.expiresAt > Date.now() ? pending.runId : null;
}

export function clearPendingAgentAsk(chatKey: string): void {
  pendingAsks.delete(chatKey);
}

export function hasPendingAgentAsk(chatKey: string): boolean {
  const pending = pendingAsks.get(chatKey);
  if (!pending) return false;
  if (pending.expiresAt > Date.now()) return true;
  pendingAsks.delete(chatKey);
  return false;
}

function rememberPendingAsk(chatKey: string, runId: string): void {
  pendingAsks.set(chatKey, { runId, expiresAt: Date.now() + askTtlMs() });
}

export const __rememberPendingAskForTest = rememberPendingAsk;

function toResult(
  outcome: AgentRunOutcome | SearchRunOutcome,
  targetUrl: string,
  strings: Strings,
  startedAt: number,
  askChatKey: string | undefined,
  sessionKey: string,
): BotBuiltinRunResult {
  const elapsedSeconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
  const providerLabel = getProviderLabel(targetUrl);
  const answer = outcome.answer?.trim() ?? '';

  if (!outcome.success || !answer) {
    return {
      ok: false,
      text: outcome.error?.trim() || t(strings, 'bot.builtin.failed'),
      title: '',
      savedFileName: '',
      providerLabel,
      elapsedSeconds,
      awaitingAnswer: false,
    };
  }

  const question = 'question' in outcome ? outcome.question : undefined;
  const runId = 'runId' in outcome ? outcome.runId : undefined;
  const awaitingAnswer = Boolean(question && runId && askChatKey);
  if (awaitingAnswer && askChatKey && runId) rememberPendingAsk(askChatKey, runId);

  if (outcome.filePath) void setBotConversation(sessionKey, outcome.filePath);

  return {
    ok: true,
    text: awaitingAnswer ? `${answer}\n\n${t(strings, 'bot.builtin.answerHint')}` : answer,
    title: outcome.title ?? '',
    savedFileName: outcome.filePath ? path.basename(outcome.filePath) : '',
    providerLabel,
    elapsedSeconds,
    awaitingAnswer,
  };
}

export interface BotBuiltinRunRequest {
  key: BotBuiltinCommandKey;
  input: string;
  targetUrl: string;
  chatKey: string;
  onProgressText?: (text: string) => void;
}

export async function runBotBuiltinCommand(
  deps: BotBuiltinDeps,
  request: BotBuiltinRunRequest,
): Promise<BotBuiltinRunResult> {
  const strings = deps.getStrings();
  const flowManager = deps.getFlowManager() ?? undefined;
  const targetUrl = request.targetUrl.trim() || config.targetUrl;
  const startedAt = Date.now();

  clearPendingAgentAsk(request.chatKey);

  const conversationPath = await getBotConversation(request.chatKey);

  if (request.key === 'search') {
    const outcome = await runSearchCommand(flowManager, {
      query: request.input,
      strings,
      targetUrl,
      origin: 'bot',
      ...(conversationPath ? { conversationPath } : {}),
      ...(request.onProgressText ? { onProgressText: request.onProgressText } : {}),
    });
    return toResult(outcome, targetUrl, strings, startedAt, undefined, request.chatKey);
  }

  const now = new Date().toISOString();
  const state: AgentRunState = {
    runId: randomUUID(),
    goal: request.input,
    providerUrl: targetUrl,
    ...(conversationPath ? { conversationPath } : {}),
    status: 'running',
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
  const outcome = await executeAgentRun(
    { flowManager, getMainWin: () => null },
    {
      state,
      strings,
      origin: 'bot',
      ...(request.onProgressText ? { onProgressText: request.onProgressText } : {}),
    },
  );
  return toResult(outcome, targetUrl, strings, startedAt, request.chatKey, request.chatKey);
}

export async function resumeBotAgentAsk(
  deps: BotBuiltinDeps,
  params: {
    runId: string;
    answer: string;
    chatKey: string;
    onProgressText?: (text: string) => void;
  },
): Promise<BotBuiltinRunResult | null> {
  const strings = deps.getStrings();
  const state = await loadRunState(params.runId);
  if (!state || state.status === 'done') {
    sendLog(`[bot] agent run ${params.runId} is no longer resumable`);
    return null;
  }

  const answer = params.answer.trim();
  const resumeFrom = applyAnswer(state.turns, answer);
  state.turns = resumeFrom;
  state.status = 'running';
  state.error = undefined;
  state.updatedAt = new Date().toISOString();

  const startedAt = Date.now();
  const outcome = await executeAgentRun(
    { flowManager: deps.getFlowManager() ?? undefined, getMainWin: () => null },
    {
      state,
      resumeFrom,
      strings,
      deliveredPrompt: answer || state.goal,
      origin: 'bot',
      ...(params.onProgressText ? { onProgressText: params.onProgressText } : {}),
    },
  );
  return toResult(outcome, state.providerUrl, strings, startedAt, params.chatKey, params.chatKey);
}
