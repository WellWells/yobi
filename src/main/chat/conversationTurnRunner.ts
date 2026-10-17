import { config } from '../config';
import { detectProvider } from '../providers';
import type { ByokUsage } from '../providers/byokClient';
import { isByokTargetUrl } from '../../shared/types';
import { readMapPlaceRef } from '../../shared/conversationDoc';
import { currentRecap } from '../../shared/recap';
import type { ConversationDoc, MapPlaceRef, ThreadMeta, TurnMeta } from '../../shared/conversationDoc';
import { unsentEditedTurns } from '../../shared/editedReplies';
import {
  contextBudgetFor,
  inlineBudgetFor,
  packReplayPrompt,
  replayReplacesThread,
  resolveContextMode,
  turnsConsumedBySummary,
  type ContextMode,
} from './conversationContext';
import { commitConversationTurn, loadConversation } from './conversationStore';
import { buildEditedRepliesNote } from './editedReplies';
import { summarizeTurns } from './summarizer';

export interface ConversationSendPlan {
  mode: ContextMode;
  promptToSend: string;
  expectThreadUrl?: string;
  turnMeta: TurnMeta;
  thread: ThreadMeta;
  previousTurnCount: number;
  /** The prompt re-attaches fetched place data, which the memory gate treats as outside content. */
  external?: true;
  /** Where the conversation stood before this send, for the recap rule; absent when nothing was recorded. */
  recap?: string;
  /** How many answers the user edited since the last turn, carried ahead of a native follow-up. */
  editedReplies?: number;
}

/** Builds the place data re-attached to a replay, fitted to `limit` under `measure`; '' when unavailable. */
export type PlaceContextBuilder = (
  ref: MapPlaceRef,
  limit: number,
  measure: (text: string) => number,
) => Promise<string>;

/** Share of the replay budget the place data may take; the history and the question get the rest. */
const PLACE_CONTEXT_SHARE = 0.6;

export function providerKeyFor(targetUrl: string): string {
  return isByokTargetUrl(targetUrl) ? 'byok' : detectProvider(targetUrl);
}

export async function planConversationSend(args: {
  conversationPath: string;
  targetUrl: string;
  userPrompt: string;
  timeoutMs: number;
  allowNative?: boolean;
  placeContext?: PlaceContextBuilder;
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
  placeContext?: PlaceContextBuilder;
}): Promise<ConversationSendPlan> {
  const { doc, targetUrl, userPrompt, timeoutMs, allowNative = true } = args;
  const nativeOk = allowNative && resolveContextMode(doc.thread, targetUrl, doc.turns.length) === 'native';
  // Both modes: a native plan whose thread turns out to be gone replays with the same recap.
  const recap = currentRecap(doc)?.text;

  if (nativeOk) {
    // A replay re-sends the edited text from the file; the provider's thread still has the original.
    const edited = unsentEditedTurns(doc.turns).map((index) => doc.turns[index]);
    const editNote = buildEditedRepliesNote(edited);
    const inline = inlineBudgetFor(targetUrl, config.byokContextBudgetChars);
    // Edits too long to ride along with a question go out as a replay, which starts a new thread.
    if (!editNote || inline.measure(editNote) <= inline.budget) {
      return {
        mode: 'native',
        promptToSend: editNote ? `${editNote}\n\n${userPrompt}` : userPrompt,
        expectThreadUrl: doc.thread.threadUrl,
        turnMeta: { m: 'native' },
        thread: doc.thread,
        previousTurnCount: doc.turns.length,
        ...(edited.length > 0 ? { editedReplies: edited.length } : {}),
        ...(recap ? { recap } : {}),
      };
    }
  }
  const mode: ContextMode = 'replay';

  const { budget, measure } = contextBudgetFor(targetUrl, config.byokContextBudgetChars);
  let summary = doc.thread.summary ?? '';
  let summarizedTurns = doc.thread.summarizedTurns ?? 0;

  const place = readMapPlaceRef(doc.thread);
  const preamble = place && args.placeContext
    ? await args.placeContext(place, Math.floor(budget * PLACE_CONTEXT_SHARE), measure)
    : '';

  const pending = doc.turns.slice(summarizedTurns);
  let packed = packReplayPrompt({
    turns: pending,
    summary,
    newPrompt: userPrompt,
    budget,
    measure,
    preamble,
  });

  if (packed.overflow.length > 0) {
    const result = await summarizeTurns({
      turns: packed.overflow,
      previousSummary: summary,
      targetUrl,
      timeoutMs,
    });
    if (result) {
      // Advance by what the summary actually covered, measured against the DOCUMENT: the
      // overflow leaves out turns with no answer, and the summariser may have covered fewer
      // turns than it was offered to stay inside the provider's prompt limit.
      summarizedTurns += turnsConsumedBySummary(pending, packed.overflow, result.covered);
      summary = result.summary;
      packed = packReplayPrompt({
        turns: doc.turns.slice(summarizedTurns),
        summary,
        newPrompt: userPrompt,
        budget,
        measure,
        preamble,
      });
    }
  }

  return {
    mode,
    promptToSend: packed.prompt,
    ...(preamble ? { external: true as const } : {}),
    turnMeta: {
      m: 'replay',
      ...(replayReplacesThread(doc.thread, targetUrl) ? { fb: 1 as const } : {}),
      ...(packed.droppedTurns > 0 ? { dropped: packed.droppedTurns } : {}),
      ...(summarizedTurns > 0 ? { summarized: summarizedTurns } : {}),
    },
    thread: {
      ...doc.thread,
      v: 1,
      ...(summary ? { summary, summarizedTurns } : {}),
    },
    previousTurnCount: doc.turns.length,
    ...(recap ? { recap } : {}),
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
  /**
   * What a native follow-up carries instead of the full instruction, which the thread already
   * received in its first message. Absent = the prompt goes out exactly as typed.
   */
  withNativeReminder?: (prompt: string) => string;
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
    if (current?.mode !== 'native') return withInstruction(base);
    return args.withNativeReminder ? args.withNativeReminder(base) : base;
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
  /** Set when this send started a new provider thread; a native follow-up keeps the old value. */
  threadAt?: string;
}): Promise<void> {
  const { threadUrl, targetUrl, previousTurnCount } = args;
  const thread: ThreadMeta = threadUrl
    ? {
      ...args.thread,
      v: 1,
      provider: providerKeyFor(targetUrl),
      threadUrl,
      threadTurns: previousTurnCount + 1,
      ...(args.threadAt ? { threadAt: args.threadAt } : {}),
    }
    : { ...args.thread, v: 1 };

  await commitConversationTurn({
    filePath: args.conversationPath,
    turn: { prompt: args.prompt, response: args.response, meta: args.meta },
    thread,
  });
}
