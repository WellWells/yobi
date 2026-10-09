import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_AGENT_ASK_TTL_MINUTES } from '../shared/types';
import type { AgentRunState, BotPlatform, BotRunKind } from '../shared/types';
import { config } from './config';
import { executeAgentRun } from './chat/agentCommand';
import {
  BOT_CHAT_TOOL_SCOPE, BOT_TOOL_SCOPE, withLocalCapability, withShellCapability, withWebCapability,
} from './flow/agent/agentTools';
import { runSearchCommand } from './chat/searchCommand';
import type { AgentRunOutcome, AgentRunRequest } from './chat/agentCommand';
import type { SearchRunOutcome } from './chat/searchCommand';
import { getBotConversation, setBotConversation } from './botConversations';
import { botConversationFileLabel } from './botConversationLabel';
import { applyAnswer, loadRunState } from './flow/agent/agentRunStore';
import { sendLog } from './helpers';
import { t } from './i18n';
import { getProviderLabel } from './providers';
import type { FlowManager } from './flow';
import { botChatMemoryResolver } from './chat/agentMemory';
import { withMemoryNotes } from './memory';
import { applyBotRunGrants, botAccessDeniedText, botChatPaired, botChatRights } from './botPermissions';
import { builtinCommandGrant, rightsAllowBuiltin } from '../shared/botPermissions';

type Strings = Record<string, string>;

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

/** The name a new conversation file gets for this chat; a lookup that fails only costs the name. */
export function newConversationLabel(chatKey: string): Promise<string> {
  return botConversationFileLabel(chatKey).catch(() => '');
}

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

  const memoryNotes = 'memoryNotes' in outcome ? outcome.memoryNotes ?? [] : [];

  return {
    ok: true,
    text: awaitingAnswer
      ? `${answer}\n\n${t(strings, 'bot.builtin.answerHint')}`
      : withMemoryNotes(answer, memoryNotes, (key, vars) => t(strings, key, vars)),
    title: outcome.title ?? '',
    savedFileName: outcome.filePath ? path.basename(outcome.filePath) : '',
    providerLabel,
    elapsedSeconds,
    awaitingAnswer,
  };
}

type BotRunScope = Pick<AgentRunRequest, 'toolScope' | 'linkQuestions' | 'allowedMcpServerIds' | 'shellInChat'>;

/**
 * The tools a bot run may use, read off its saved state, so a resume can never widen the run. Fails
 * closed: only a run recorded as `agent` gets the wider kit; the account's grants then remove local,
 * web and ungranted connector tools, and the shell grant adds `shell` (each command is confirmed in
 * the chat).
 *
 * A Maps link with a question is answered from reviews on either kit: a bot run cannot write files,
 * flows or connector data, so the words around the link are a question about the place.
 */
function botRunScope(state: AgentRunState): BotRunScope {
  const full = state.botScope === 'agent';
  const grants = state.botGrants;
  const shell = full && grants?.shell === true;
  const toolScope = withWebCapability(
    withShellCapability(withLocalCapability(full ? BOT_TOOL_SCOPE : BOT_CHAT_TOOL_SCOPE, grants?.local === true), shell),
    grants?.web !== false && state.web !== false,
  );
  const connectors = grants?.connectors;
  return {
    toolScope,
    linkQuestions: true,
    ...(Array.isArray(connectors) ? { allowedMcpServerIds: connectors } : {}),
    ...(shell ? { shellInChat: true } : {}),
  };
}

function deniedResult(targetUrl: string, text: string): BotBuiltinRunResult {
  return {
    ok: false,
    text,
    title: '',
    savedFileName: '',
    providerLabel: getProviderLabel(targetUrl),
    elapsedSeconds: '0.0',
    awaitingAnswer: false,
  };
}

export interface BotBuiltinRunRequest {
  /** `agent` answers a message or a model command (`/gemini …`); `search` is the typed `/search`. */
  key: BotRunKind;
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

  // Decided here as well as in the chat handlers, which refuse before anything is queued: whoever
  // calls this, an unpaired account gets no run and a typed command it was not granted never runs.
  if (!botChatPaired(request.chatKey)) {
    sendLog(`[bot] ${request.key} refused for ${request.chatKey}: not paired`);
    return deniedResult(targetUrl, t(strings, 'bot.builtin.failed'));
  }
  const rights = await botChatRights(request.chatKey);
  if (request.key !== 'agent' && !rightsAllowBuiltin(rights, request.key)) {
    sendLog(`[bot] /${request.key} refused for ${request.chatKey}: not granted`);
    return deniedResult(targetUrl, botAccessDeniedText(strings, builtinCommandGrant(request.key)));
  }

  clearPendingAgentAsk(request.chatKey);

  const conversationPath = await getBotConversation(request.chatKey);
  const fileLabel = conversationPath ? '' : await newConversationLabel(request.chatKey);

  if (request.key === 'search') {
    const outcome = await runSearchCommand(flowManager, {
      query: request.input,
      strings,
      targetUrl,
      origin: 'bot',
      ...(conversationPath ? { conversationPath } : { fileLabel }),
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
    // Every paired account is answered; the agent grant decides how much the answer may use.
    botScope: rights.agent ? 'agent' : 'chat',
    status: 'running',
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
  applyBotRunGrants(state, rights, false);
  const outcome = await executeAgentRun(
    { flowManager, getMainWin: () => null },
    {
      state,
      strings,
      origin: 'bot',
      memory: botChatMemoryResolver(request.chatKey),
      ...botRunScope(state),
      ...(fileLabel ? { fileLabel } : {}),
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

  // Re-read now: a grant taken away while the question was pending applies to the answer too. An
  // account unpaired meanwhile gets nothing; one still paired is answered, on the chat kit if the
  // agent grant is gone.
  if (!botChatPaired(params.chatKey)) {
    sendLog(`[bot] agent run ${params.runId} not resumed: ${params.chatKey} is no longer paired`);
    return deniedResult(state.providerUrl, t(strings, 'bot.builtin.failed'));
  }
  const rights = await botChatRights(params.chatKey);
  if (state.botScope === 'agent' && !rights.agent) {
    sendLog(`[bot] agent run ${params.runId} resumes on the chat scope: the agent grant is gone`);
    state.botScope = 'chat';
  }

  const answer = params.answer.trim();
  const resumeFrom = applyAnswer(state.turns, answer);
  state.turns = resumeFrom;
  state.status = 'running';
  state.error = undefined;
  state.updatedAt = new Date().toISOString();
  applyBotRunGrants(state, rights, true);

  const startedAt = Date.now();
  const outcome = await executeAgentRun(
    { flowManager: deps.getFlowManager() ?? undefined, getMainWin: () => null },
    {
      state,
      resumeFrom,
      strings,
      deliveredPrompt: answer || state.goal,
      origin: 'bot',
      memory: botChatMemoryResolver(params.chatKey),
      ...botRunScope(state),
      ...(params.onProgressText ? { onProgressText: params.onProgressText } : {}),
    },
  );
  return toResult(outcome, state.providerUrl, strings, startedAt, params.chatKey, params.chatKey);
}
