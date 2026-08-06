import { config } from '../config';
import { detectProvider } from '../providers';
import type { ByokUsage } from '../providers/byokClient';
import { isByokTargetUrl } from '../../shared/types';
import type { ConversationDoc, ThreadMeta, TurnMeta } from '../../shared/conversationDoc';
import {
  contextBudgetFor,
  packReplayPrompt,
  resolveContextMode,
  type ContextMode,
} from './conversationContext';
import { commitConversationTurn, loadConversation } from './conversationStore';
import { summarizeTurns } from './summarizer';

export interface ConversationSendPlan {
  mode: ContextMode;
  promptToSend: string;
  expectThreadUrl?: string;
  turnMeta: TurnMeta;
  thread: ThreadMeta;
  previousTurnCount: number;
}

export function providerKeyFor(targetUrl: string): string {
  return isByokTargetUrl(targetUrl) ? 'byok' : detectProvider(targetUrl);
}

export async function planConversationSend(args: {
  conversationPath: string;
  targetUrl: string;
  userPrompt: string;
  timeoutMs: number;
  allowNative?: boolean;
}): Promise<ConversationSendPlan | null> {
  const loaded = await loadConversation(args.conversationPath);
  if (!loaded) return null;
  return planTurn({ ...args, doc: loaded.doc });
}

export async function planTurn(args: {
  doc: ConversationDoc;
  targetUrl: string;
  userPrompt: string;
  timeoutMs: number;
  allowNative?: boolean;
}): Promise<ConversationSendPlan> {
  const { doc, targetUrl, userPrompt, timeoutMs, allowNative = true } = args;
  const mode = allowNative
    ? resolveContextMode(doc.thread, targetUrl, doc.turns.length)
    : 'replay';

  if (mode === 'native') {
    return {
      mode,
      promptToSend: userPrompt,
      expectThreadUrl: doc.thread.threadUrl,
      turnMeta: { m: 'native' },
      thread: doc.thread,
      previousTurnCount: doc.turns.length,
    };
  }

  const { budget, measure } = contextBudgetFor(targetUrl, config.byokContextBudgetChars);
  let summary = doc.thread.summary ?? '';
  let summarizedTurns = doc.thread.summarizedTurns ?? 0;

  let packed = packReplayPrompt({
    turns: doc.turns.slice(summarizedTurns),
    summary,
    newPrompt: userPrompt,
    budget,
    measure,
  });

  if (packed.overflow.length > 0) {
    const nextSummary = await summarizeTurns({
      turns: packed.overflow,
      previousSummary: summary,
      targetUrl,
      timeoutMs,
    });
    if (nextSummary) {
      summarizedTurns += packed.overflow.length;
      summary = nextSummary;
      packed = packReplayPrompt({
        turns: doc.turns.slice(summarizedTurns),
        summary,
        newPrompt: userPrompt,
        budget,
        measure,
      });
    }
  }

  return {
    mode,
    promptToSend: packed.prompt,
    turnMeta: {
      m: 'replay',
      ...(packed.droppedTurns > 0 ? { dropped: packed.droppedTurns } : {}),
      ...(summarizedTurns > 0 ? { summarized: summarizedTurns } : {}),
    },
    thread: {
      ...doc.thread,
      v: 1,
      ...(summary ? { summary, summarizedTurns } : {}),
    },
    previousTurnCount: doc.turns.length,
  };
}

export interface ConversationalSendResult {
  response: string;
  title: string;
  threadUrl: string | null;
  plan: ConversationSendPlan | null;
  outgoingPrompt: string;
  usage: ByokUsage | null;
}

export async function executeConversationalSend(args: {
  plan: ConversationSendPlan | null;
  targetUrl: string;
  userPrompt: string;
  replanAsReplay: () => Promise<ConversationSendPlan | null>;
  withInstruction: (prompt: string) => string;
  runBrowser: (prompt: string, expectThreadUrl?: string) => Promise<{
    response: string; title: string; threadUrl: string | null; threadLost?: true;
    sentPrompt?: string;
  }>;
  runByok: (prompt: string) => Promise<{ response: string; title: string; usage: ByokUsage | null }>;
  onThreadLost: () => void;
}): Promise<ConversationalSendResult> {
  const { targetUrl, userPrompt, withInstruction, runBrowser, runByok } = args;
  let plan = args.plan;

  const promptFor = (current: ConversationSendPlan | null): string => {
    const base = current ? current.promptToSend : userPrompt;
    return current?.mode === 'native' ? base : withInstruction(base);
  };

  if (isByokTargetUrl(targetUrl)) {
    const outgoingPrompt = promptFor(plan);
    const result = await runByok(outgoingPrompt);
    return { ...result, threadUrl: null, plan, outgoingPrompt };
  }

  let outgoingPrompt = promptFor(plan);
  let result = await runBrowser(outgoingPrompt, plan?.expectThreadUrl);
  if (result.threadLost) {
    args.onThreadLost();
    plan = await args.replanAsReplay();
    outgoingPrompt = promptFor(plan);
    result = await runBrowser(outgoingPrompt);
  }
  return {
    response: result.response,
    title: result.title,
    threadUrl: result.threadUrl,
    plan,
    outgoingPrompt: result.sentPrompt ?? outgoingPrompt,
    usage: null,
  };
}

export async function recordConversationTurn(args: {
  conversationPath: string;
  prompt: string;
  response: string;
  meta: TurnMeta;
  thread: ThreadMeta;
  threadUrl: string | null;
  targetUrl: string;
  previousTurnCount: number;
}): Promise<void> {
  const { threadUrl, targetUrl, previousTurnCount } = args;
  const thread: ThreadMeta = threadUrl
    ? {
      ...args.thread,
      v: 1,
      provider: providerKeyFor(targetUrl),
      threadUrl,
      threadTurns: previousTurnCount + 1,
    }
    : { ...args.thread, v: 1 };

  await commitConversationTurn({
    filePath: args.conversationPath,
    turn: { prompt: args.prompt, response: args.response, meta: args.meta },
    thread,
  });
}
