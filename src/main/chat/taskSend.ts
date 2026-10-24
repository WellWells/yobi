import { runAutomation, getProviderLabel, preparePromptForProvider } from '../providers';
import type { AutomationResult } from '../providers';
import { withAnswerSvgPictures } from '../providers/generatedImages';
import { runByokCompletion } from '../providers/byokClient';
import type { ByokImage } from '../providers/byokClient';
import { byokImagesFor, withByokImages } from '../providers/byokImages';
import { geminiCapFellSince } from '../providers/geminiPromptTooLong';
import { promptCapFor } from './conversationContext';
import { executeConversationalSend, planConversationSend, planTurn } from './conversationTurnRunner';
import type { ConversationSendPlan, ConversationalSendResult } from './conversationTurnRunner';
import type { TaskChatContext } from './taskChatContext';
import { taskMemoryInstruction, taskNativeReminder } from './taskMemory';
import type { ResolvedMemory } from '../memory';
import { RECAP_RULE, recapRules } from './recapPrompt';
import { buildPlaceContext } from '../mapUrlPrompt';
import { getTempChatConversation } from '../tempChat';
import { config } from '../config';
import { isByokTargetUrl } from '../../shared/types';
import type { PromptPreferences, Task } from '../../shared/types';
import { sendLog, sanitizeRequesterName } from '../helpers';
import { llmLane } from '../flow/lanes';
import { buildCombinedPromptFromPrefs, buildTaskInstruction, getLangCache, t } from '../i18n';
import { ensureWorkerWindow } from '../windows';
import { workerWindowUnavailable } from '../workerWindowError';

function resolvePromptPrefs(task: Task): PromptPreferences {
  const isBotTask = task.source === 'telegram' || task.source === 'line';
  if (!isBotTask) return config.promptPreferences;
  return { ...config.promptPreferences, nickname: sanitizeRequesterName(task.requesterName) };
}

export function providerNamesItsThread(targetUrl: string): boolean {
  return !isByokTargetUrl(targetUrl);
}

/** What a chat task's send settles once, before any provider is tried. */
export interface TaskSendContext {
  task: Task;
  chatContext: TaskChatContext;
  memory: ResolvedMemory;
  recapWanted: boolean;
}

export interface TaskSendResult {
  plan: ConversationSendPlan | null;
  sent: ConversationalSendResult;
  /** Taken before the send: an entry this very answer adds must count as newer than the thread. */
  sentAt: string;
  byokImages: ByokImage[] | undefined;
}

/**
 * One provider's whole send of a chat task, planned for that provider: a follow-up sent to a
 * provider other than the thread's replays the conversation as text, and one sent back to the
 * thread's provider continues the thread.
 */
export async function sendTaskTo(ctx: TaskSendContext, sendUrl: string): Promise<TaskSendResult> {
  const { task, chatContext, memory, recapWanted } = ctx;
  const { id, prompt } = task;
  const sendLabel = getProviderLabel(sendUrl);
  const planTurnFor = async (allowNative: boolean): Promise<ConversationSendPlan | null> => {
    const shared = {
      targetUrl: sendUrl,
      userPrompt: prompt,
      timeoutMs: config.responseTimeout,
      allowNative,
      // A prompt that already carries fetched content (another place, a page) brings its own data.
      ...(task.external || task.mapPlace ? {} : { placeContext: buildPlaceContext }),
    };
    if (chatContext.conversationPath) {
      return planConversationSend({ conversationPath: chatContext.conversationPath, ...shared });
    }
    if (!chatContext.useTemporaryContext) return null;
    const tempDoc = await getTempChatConversation();
    return tempDoc ? planTurn({ doc: tempDoc, ...shared }) : null;
  };
  // Gemini's cap can drop between planning and sending (the picker showed it signed out).
  const capAtPlan = promptCapFor(sendUrl);
  let plan = await planTurnFor(true);
  if (plan) {
    const { dropped, summarized } = plan.turnMeta;
    const detail = plan.mode === 'native'
      ? (plan.editedReplies
        ? `resuming the provider thread with ${plan.editedReplies} edited reply(ies) ahead of the question`
        : 'resuming the provider thread, nothing resent')
      : [
        `${plan.previousTurnCount} prior turn(s)`,
        summarized ? `${summarized} summarized` : '',
        dropped ? `${dropped} dropped` : '',
      ].filter(Boolean).join(', ');
    sendLog(`[${id}] 🧵 Context: ${plan.mode} — ${detail}`);
  }

  const isOpeningTurn = (plan?.previousTurnCount ?? 0) === 0;
  const needsTitle = isOpeningTurn && !task.title?.trim();
  const wantsTitleMarker = needsTitle && !providerNamesItsThread(sendUrl);
  if (wantsTitleMarker) {
    sendLog(`[${id}] 🏷️ ${sendLabel} has no thread title — asking the model to name this conversation`);
  }

  const dynamicInstruction = [
    buildCombinedPromptFromPrefs(resolvePromptPrefs(task), getLangCache()),
    taskMemoryInstruction(memory),
  ].filter(Boolean).join('\n');
  const instruction = buildTaskInstruction(
    dynamicInstruction,
    config.syncSystemLanguageToModel,
    config.locale,
    [
      ...(wantsTitleMarker ? [t(getLangCache(), 'chat.title.markerRule')] : []),
      ...(recapWanted ? recapRules(plan?.recap) : []),
    ],
  );
  const withInstruction = (text: string): string => (instruction ? `${instruction}\n\n${text}` : text);
  // The user's own words end the prompt, so a cut would drop exactly them. A pasted link's page
  // text or transcript (displayPrompt, external, mapPlace) ends with data and keeps the tail cut.
  const ownText = !task.external && !task.displayPrompt && !task.mapPlace;

  const runBrowserTask = async (
    outgoingPrompt: string,
    expectThreadUrl?: string,
  ): Promise<AutomationResult & { sentPrompt: string }> => llmLane.runExclusive(async () => {
    // Inside the lane: a Gemini run queued ahead can lower the cap this prompt is sized for.
    const preparedPrompt = preparePromptForProvider(outgoingPrompt, sendUrl, { refuseCut: ownText });
    if (preparedPrompt.removedBlankLines) {
      sendLog(`[${id}] ✂️ Removed blank lines before sending to ${sendLabel}`);
    }
    if (preparedPrompt.truncated) {
      sendLog(`[${id}] ✂️ Prompt truncated to ${preparedPrompt.capLabel} for ${sendLabel}`);
    }
    const activeWorker = await ensureWorkerWindow(config.targetUrl, 'automation');
    if (!activeWorker || activeWorker.isDestroyed()) throw workerWindowUnavailable();
    const automated = await runAutomation(
      activeWorker,
      preparedPrompt.prompt,
      config.responseTimeout,
      sendUrl,
      task.attachments,
      expectThreadUrl,
      needsTitle,
      // Yobi's temporary chat is not saved here, so it is not kept in the provider either.
      chatContext.temporary,
    );
    // Still in the lane and on the provider's page: an SVG answer is drawn there.
    const pictured = await withAnswerSvgPictures(activeWorker, automated);
    return { ...pictured, sentPrompt: preparedPrompt.prompt };
  });

  const byokImages = isByokTargetUrl(sendUrl)
    ? await byokImagesFor(sendUrl, task.attachments, `[${id}]`)
    : undefined;

  const sentAt = new Date().toISOString();
  // A native thread sees its own earlier recap lines, so the bare rule is enough there.
  const withNativeReminder = taskNativeReminder(memory, plan?.thread.threadAt, recapWanted ? [RECAP_RULE] : []);
  const send = (planned: ConversationSendPlan | null): Promise<ConversationalSendResult> => executeConversationalSend({
    plan: planned,
    targetUrl: sendUrl,
    userPrompt: prompt,
    replanAsReplay: () => planTurnFor(false),
    withInstruction,
    ...(withNativeReminder ? { withNativeReminder } : {}),
    runBrowser: runBrowserTask,
    runByok: (outgoing) => runByokCompletion(sendUrl, withByokImages(outgoing, byokImages), config.responseTimeout),
    onThreadLost: () => sendLog(`[${id}] 🧵 Stored conversation thread is gone — continuing with a text recap`),
  });
  let sent: ConversationalSendResult;
  try {
    sent = await send(plan);
  } catch (err) {
    // Refused before anything was clicked, because the cap fell after the plan was packed for the
    // larger one: plan again at the cap that holds now and send once more.
    if (!geminiCapFellSince(capAtPlan, err)) throw err;
    sendLog(`[${id}] ✂️ ${sendLabel} takes only ${promptCapFor(sendUrl)} characters now — planning the turn again`);
    plan = plan ? await planTurnFor(true) : null;
    sent = await send(plan);
  }
  return { plan, sent, sentAt, byokImages };
}
