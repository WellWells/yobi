import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_AGENT_ASK_TTL_MINUTES } from '../shared/types';
import type { AgentChatLine, AgentReplyContext, AgentRunState, BotPlatform, BotRunKind } from '../shared/types';
import { config } from './config';
import { executeAgentRun } from './chat/agentCommand';
import {
  BOT_CHAT_TOOL_SCOPE, BOT_TOOL_SCOPE, withFlowCapability, withLocalCapability, withPictureCapability, withShellCapability,
  withWebCapability,
} from './flow/agent/agentTools';
import { runSearchCommand } from './chat/searchCommand';
import { runImageCommand } from './chat/imageCommand';
import type { ImageRunOutcome } from './chat/imageCommand';
import { parseImageRequest, pictureIsWholeJob } from '../shared/imageRequest';
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
import { applyBotRunGrants, botAccessDeniedText, botChatApprovesConnectorChanges, botChatFlowBuilder, botChatRights } from './botPermissions';
import { parseBotChatKey } from './memory/memoryContext';
import { discloseBotConnectors, rememberBotConnectors } from './botConnectorScope';
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
  /**
   * Send `text` exactly as written, as plain text whatever the reply mode, or not at all: it asks
   * to approve a shell command or a connector change, and what the user reads must be what runs.
   */
  verbatim?: boolean;
  /**
   * The question on its own, when it offers choices: a platform with buttons shows them instead of
   * the numbered list in `text`. A press sends the choice's text back, as typing it would.
   */
  question?: { runId: string; text: string; choices: string[] };
  /** Pictures that go with the text (a drawn picture), kept in the chat's media folder. */
  files?: string[];
}

/**
 * When a chat message was sent, as far as the platform says: Telegram's `message_id` (in one chat a
 * later message has a larger id) and the latest moment it can have been sent (Telegram's `date` is
 * whole seconds, so the end of that second; LINE: its own timestamp or when its webhook arrived
 * here, whichever is earlier).
 */
export interface BotMessageSent {
  messageId?: number;
  sentAt?: number;
}

/** How a question reached the user, once it was sent. */
export interface AgentAskShown {
  /** The message that carries it (Telegram), when one does. */
  messageId?: number;
  /** Its choices were listed with numbers; buttons show none (`applyAnswer`). */
  numbered: boolean;
}

interface PendingAsk {
  runId: string;
  expiresAt: number;
  /** When the run asked (this computer's clock). */
  askedAt: number;
  shownMessageId?: number;
  /** The text form numbers the choices; a platform that shows buttons instead says so when sent. */
  numbered: boolean;
}

const pendingAsks = new Map<string, PendingAsk>();

/**
 * Whether a message can be the answer: only one sent after the question was (2026-10-20: a second
 * "1", sent while the run that asked was still working, was read after the question and taken as
 * its answer). Telegram compares message ids when the question's is known, else times.
 */
function sentAfterAsk(pending: PendingAsk, sent: BotMessageSent): boolean {
  if (sent.messageId !== undefined && pending.shownMessageId !== undefined) return sent.messageId > pending.shownMessageId;
  return sent.sentAt === undefined || sent.sentAt > pending.askedAt;
}

export function botChatKey(platform: BotPlatform, chatId: string, userId: string): string {
  return `${platform}:${chatId}:${userId}`;
}

function askTtlMs(): number {
  const minutes = config.builtinCommands?.askTtlMinutes ?? DEFAULT_AGENT_ASK_TTL_MINUTES;
  return minutes * 60_000;
}

/** Takes the question this chat key answers: the run that asked, and whether its choices were numbered. */
export function takePendingAgentAnswer(chatKey: string): { runId: string; numbered: boolean } | null {
  const pending = pendingAsks.get(chatKey);
  if (!pending) return null;
  pendingAsks.delete(chatKey);
  return pending.expiresAt > Date.now() ? { runId: pending.runId, numbered: pending.numbered } : null;
}

export function takePendingAgentAsk(chatKey: string): string | null {
  return takePendingAgentAnswer(chatKey)?.runId ?? null;
}

export function clearPendingAgentAsk(chatKey: string): void {
  pendingAsks.delete(chatKey);
}

/** The run whose question this chat key still has to answer, without taking it; null when none or expired. */
export function pendingAgentAskRunId(chatKey: string): string | null {
  const pending = pendingAsks.get(chatKey);
  if (!pending) return null;
  if (pending.expiresAt > Date.now()) return pending.runId;
  pendingAsks.delete(chatKey);
  return null;
}

/**
 * Whether a question is waiting in this chat key — and, given a message's `sent`, whether that
 * message answers it. One sent before the question is a request of its own, paced like any other.
 */
export function hasPendingAgentAsk(chatKey: string, sent?: BotMessageSent): boolean {
  if (pendingAgentAskRunId(chatKey) === null) return false;
  const pending = pendingAsks.get(chatKey);
  return !sent || !pending || sentAfterAsk(pending, sent);
}

/** The question went out: the message that carries it, and whether its choices were numbered. */
export function markAgentAskShown(chatKey: string, shown: AgentAskShown): void {
  const pending = pendingAsks.get(chatKey);
  if (!pending) return;
  pending.numbered = shown.numbered;
  if (shown.messageId !== undefined) pending.shownMessageId = shown.messageId;
}

function rememberPendingAsk(chatKey: string, runId: string): void {
  const now = Date.now();
  pendingAsks.set(chatKey, { runId, expiresAt: now + askTtlMs(), askedAt: now, numbered: true });
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
  const choices = 'choices' in outcome ? outcome.choices ?? [] : [];
  // Pictures the agent drew go with its answer, never with a question.
  const files = !awaitingAnswer && 'files' in outcome ? outcome.files ?? [] : [];

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
    ...(awaitingAnswer && 'shellApproval' in outcome && outcome.shellApproval ? { verbatim: true } : {}),
    ...(awaitingAnswer && question && runId && choices.length > 0 ? { question: { runId, text: question, choices } } : {}),
    ...(files.length > 0 ? { files } : {}),
  };
}

function imageResult(outcome: ImageRunOutcome, strings: Strings, startedAt: number, sessionKey: string): BotBuiltinRunResult {
  const elapsedSeconds = ((Date.now() - startedAt) / 1_000).toFixed(1);
  const base = { title: '', savedFileName: '', providerLabel: outcome.providerLabel, elapsedSeconds, awaitingAnswer: false };
  if (!outcome.success) return { ...base, ok: false, text: outcome.error?.trim() || t(strings, 'bot.builtin.failed') };
  if (outcome.filePath) void setBotConversation(sessionKey, outcome.filePath);
  return {
    ...base,
    ok: true,
    text: outcome.answer ?? '',
    title: outcome.title ?? '',
    savedFileName: outcome.filePath ? path.basename(outcome.filePath) : '',
    ...(outcome.files?.length ? { files: outcome.files } : {}),
  };
}

type BotRunScope = Pick<AgentRunRequest, 'toolScope' | 'linkQuestions' | 'allowedMcpServerIds' | 'shellInChat' | 'connectorChangesInChat' | 'flowsInChat'>;

/** What the person behind a chat key may approve in the chat, read now (a start and every resume). */
interface BotChatApprovals {
  /** The owner's own private chat: connector changes are asked, not refused. */
  connectorChanges: boolean;
  /** A flow admin's own private chat: flows are built and asked about, not left out. */
  flows: { owner: boolean; requester: { platform: BotPlatform; userId: string } } | null;
}

async function botChatApprovals(chatKey: string): Promise<BotChatApprovals> {
  const [connectorChanges, builder] = await Promise.all([botChatApprovesConnectorChanges(chatKey), botChatFlowBuilder(chatKey)]);
  const parsed = parseBotChatKey(chatKey);
  return {
    connectorChanges,
    flows: builder && parsed ? { owner: builder.owner, requester: { platform: parsed.platform, userId: parsed.userId } } : null,
  };
}

/**
 * The tools a bot run may use, read off its saved state, so a resume can never widen the run. Fails
 * closed: only a run recorded as `agent` gets the wider kit; the account's grants then remove local,
 * web and ungranted connector tools, and the shell grant adds `shell` (each command is confirmed in
 * the chat). The owner's own private chat puts connector changes to them as questions in the chat;
 * anyone else's are refused. A flow admin's own private chat (2026-10-24, user: 「管理員可以透過指令的
 * 方式去處理」) gets the flow builders, each flow held and put to them as a question before it is saved.
 *
 * A Maps link with a question is answered from reviews on either kit: the words around the link are
 * a question about the place.
 */
function botRunScope(state: AgentRunState, approvals: BotChatApprovals): BotRunScope {
  const full = state.botScope === 'agent';
  const grants = state.botGrants;
  const shell = full && grants?.shell === true;
  const web = grants?.web !== false && state.web !== false;
  const flows = full ? approvals.flows : null;
  // Drawing uses the owner's web account, as the image command does, so it takes the same grant on
  // either kit; with it, `draw_image` is offered whatever the words and the model decides.
  const toolScope = withFlowCapability(withPictureCapability(withWebCapability(
    withShellCapability(withLocalCapability(full ? BOT_TOOL_SCOPE : BOT_CHAT_TOOL_SCOPE, grants?.local === true), shell),
    web,
  ), web), flows !== null);
  const connectors = grants?.connectors;
  return {
    toolScope,
    linkQuestions: true,
    ...(Array.isArray(connectors) ? { allowedMcpServerIds: connectors } : {}),
    ...(shell ? { shellInChat: true } : {}),
    ...(full && approvals.connectorChanges && connectors !== 'none' ? { connectorChangesInChat: true } : {}),
    ...(flows ? { flowsInChat: flows } : {}),
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
  /** The chat message the request replies to; an agent run only. */
  replyTo?: AgentReplyContext;
  /** The group talk around the request; an agent run only. */
  recentChat?: AgentChatLine[];
  /** The request is about the group's talk itself. */
  chatRecap?: true;
}

/**
 * The turn as the conversation file keeps it: the requester's words, then the message they replied
 * to as a quote, so the record — and the history a later turn replays — says what "this" was. Every
 * quoted line starts with `>`, so nothing in it can pass for a heading or a turn marker.
 */
export function promptWithReply(input: string, replyTo: AgentReplyContext | undefined): string {
  const text = replyTo?.text.trim() ?? '';
  if (!text) return input;
  const name = replyTo?.from.replace(/\s+/g, ' ').trim() ?? '';
  const quoted = text.split(/\r?\n/).map((line) => (line.trim() ? `> ${line}` : '>'));
  return [input, '', ...(name ? [`> **${name}**`] : []), ...quoted].join('\n');
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
  // calls this, someone who may not talk to the bot in this chat (unpaired outside a group that
  // grants it, or blocked) gets no run, and a typed command it was not granted never runs.
  const rights = await botChatRights(request.chatKey);
  if (!rights.chat) {
    sendLog(`[bot] ${request.key} refused for ${request.chatKey}: may not use the bot here`);
    return deniedResult(targetUrl, t(strings, 'bot.builtin.failed'));
  }
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
    ...(request.replyTo ? { replyTo: request.replyTo } : {}),
    ...(request.recentChat?.length ? { recentChat: request.recentChat } : {}),
    ...(request.chatRecap ? { chatRecap: true as const } : {}),
    // Everyone allowed to talk here is answered; the agent grant decides how much the answer may use.
    botScope: rights.agent ? 'agent' : 'chat',
    status: 'running',
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
  const grants = applyBotRunGrants(state, rights, false);
  // Only the user's own words name a connector: not the message they replied to, not the group talk.
  const disclosed = await discloseBotConnectors(request.input, conversationPath ?? undefined, grants.connectors);

  // A picture asked for and nothing else: drawn on the web page it names ("使用 gpt…"; Gemini when
  // none) without an agent turn, the pictures back as photos. A shortcut, not the only way to a
  // picture: the agent has `draw_image` too, so a message asking for more (`pictureIsWholeJob`: a
  // connector named, the web, a flow) goes to it, as do a reply to someone else's message and a
  // recap of the group's talk. That uses the owner's web account as a search does, so it takes the same grant.
  if (
    request.key === 'agent' && rights.web && !request.replyTo && !request.chatRecap
    && pictureIsWholeJob(request.input, disclosed.named.length > 0) && parseImageRequest(request.input)
  ) {
    const outcome = await runImageCommand(flowManager, {
      prompt: request.input,
      strings,
      origin: 'bot',
      ...(conversationPath ? { conversationPath } : { fileLabel }),
    });
    return imageResult(outcome, strings, startedAt, request.chatKey);
  }

  if (disclosed.ids.length > 0) state.mcpServerIds = disclosed.ids;
  const outcome = await executeAgentRun(
    { flowManager, getMainWin: () => null },
    {
      state,
      strings,
      ...(request.replyTo ? { deliveredPrompt: promptWithReply(request.input, request.replyTo) } : {}),
      origin: 'bot',
      memory: botChatMemoryResolver(request.chatKey),
      ...botRunScope(state, await botChatApprovals(request.chatKey)),
      ...(fileLabel ? { fileLabel } : {}),
      ...(request.onProgressText ? { onProgressText: request.onProgressText } : {}),
    },
  );
  if (disclosed.remember && outcome.filePath) await rememberBotConnectors(outcome.filePath, disclosed.remember);
  return toResult(outcome, targetUrl, strings, startedAt, request.chatKey, request.chatKey);
}

export async function resumeBotAgentAsk(
  deps: BotBuiltinDeps,
  params: {
    runId: string;
    answer: string;
    chatKey: string;
    /** The question's choices were shown numbered (`takePendingAgentAnswer`); omitted = the text form, which numbers them. */
    numbered?: boolean;
    onProgressText?: (text: string) => void;
  },
): Promise<BotBuiltinRunResult | null> {
  const strings = deps.getStrings();
  const state = await loadRunState(params.runId);
  if (!state || state.status === 'done') {
    sendLog(`[bot] agent run ${params.runId} is no longer resumable`);
    return null;
  }

  // Re-read now: a grant taken away while the question was pending applies to the answer too.
  // Someone who may no longer talk to the bot here (unpaired, blocked, the group's grant gone)
  // gets nothing; otherwise the answer goes on, on the chat kit if the agent grant is gone.
  const rights = await botChatRights(params.chatKey);
  if (!rights.chat) {
    sendLog(`[bot] agent run ${params.runId} not resumed: ${params.chatKey} may no longer use the bot here`);
    return deniedResult(state.providerUrl, t(strings, 'bot.builtin.failed'));
  }
  if (state.botScope === 'agent' && !rights.agent) {
    sendLog(`[bot] agent run ${params.runId} resumes on the chat scope: the agent grant is gone`);
    state.botScope = 'chat';
  }

  const answer = params.answer.trim();
  const resumeFrom = applyAnswer(state.turns, answer, { numbered: params.numbered ?? true });
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
      // Read again: no longer marked as the owner (or no longer an admin), a waiting change or flow is not saved on this answer.
      ...botRunScope(state, await botChatApprovals(params.chatKey)),
      ...(params.onProgressText ? { onProgressText: params.onProgressText } : {}),
    },
  );
  return toResult(outcome, state.providerUrl, strings, startedAt, params.chatKey, params.chatKey);
}
