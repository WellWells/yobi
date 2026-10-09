import * as path from 'node:path';
import {
  runAutomation,
  getProviderLabel,
  preparePromptForProvider,
  isLoginRequiredError,
} from './providers';
import type { AutomationResult } from './providers';
import { runByokCompletion } from './providers/byokClient';
import { executeConversationalSend, planConversationSend, planTurn } from './chat/conversationTurnRunner';
import type { ConversationSendPlan } from './chat/conversationTurnRunner';
import { resolveTaskChatContext } from './chat/taskChatContext';
import { appendOrCreateConversation } from './chat/conversationPersist';
import { resolveTaskMemory, settleTaskMemory, taskMemoryInstruction, taskNativeReminder } from './chat/taskMemory';
import { RECAP_RULE, recapRules, wantsRecap } from './chat/recapPrompt';
import { extractRecapLine } from './chat/recapLine';
import { buildPlaceContext } from './mapUrlPrompt';
import { withMemoryNotes } from './memory';
import {
  claimChatTurnReport,
  claimLocalNotification,
  claimRemoteReply,
  notifyQueueLevelFailure as reportQueueLevelFailure,
  reportChatTurnFailure,
  replyRemoteError,
} from './taskReporting';
import type { TaskReportDeps } from './taskReporting';
import { parseUploadFailure } from './providers/fileDrop';
import { VERIFICATION_CHALLENGE_ERROR_NAME } from './providers/verificationChallenge';
import {
  buildOutputMarkdown,
  ensureConversationHeader,
  titleFromPrompt,
  upgradeConversationTitle,
} from './output';
import { config } from './config';
import { deliverTempChatResult, getTempChatConversation, isTempChatMode } from './tempChat';
import { IPC, isByokTargetUrl } from '../shared/types';
import type { ChatTurnEvent, PromptPreferences, Task } from '../shared/types';
import { extractTitleMarker, pickConversationTitle } from '../shared/conversationTitle';
import type { TurnMeta } from '../shared/conversationDoc';
import { attachmentMetaNames } from '../shared/conversationDoc';
import { estimateUsage } from '../shared/tokenEstimate';
import { compactPreview } from '../shared/textBudget';
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  isMainWindowFocused,
  sanitizeRequesterName,
} from './helpers';
import { setBotConversation } from './botConversations';
import { deleteTempAttachments } from './telegram/fileDownload';
import { backupClipboard, handAnswerToClipboard, restoreClipboardAfterTask } from './clipboard';
import { classifyFailure, recordTaskOutcome } from './metrics';
import { runInMetricDomain } from './llmMeter';
import { llmLane } from './flow/lanes';
import { listOutputFiles, getOutputDir } from './files';
import {
  loadLanguageData,
  getLangCache,
  buildTaskInstruction,
  buildCombinedPromptFromPrefs,
  localizeUserFacingError,
  stripSystemInstruction,
  t,
} from './i18n';
import { ensureWorkerWindow } from './windows';
import { workerWindowUnavailable } from './workerWindowError';

export type TaskProcessorDeps = TaskReportDeps;

function resolvePromptPrefs(task: Task): PromptPreferences {
  const isBotTask = task.source === 'telegram' || task.source === 'line';
  if (!isBotTask) return config.promptPreferences;
  return { ...config.promptPreferences, nickname: sanitizeRequesterName(task.requesterName) };
}

function providerNamesItsThread(targetUrl: string): boolean {
  return !isByokTargetUrl(targetUrl);
}

export async function processTask(task: Task, deps: TaskProcessorDeps): Promise<void> {
  return runInMetricDomain('chat', () => runTask(task, deps));
}

async function runTask(task: Task, deps: TaskProcessorDeps): Promise<void> {
  const { telegramRuntime, lineRuntime } = deps;
  const { id, prompt } = task;
  const promptForOutput = task.displayPrompt?.trim() ? task.displayPrompt.trim() : stripSystemInstruction(prompt);
  // When the record shows a stand-in, the turn keeps what the model was given so a replayed
  // follow-up still has it. A Maps turn keeps no copy: its reviews are re-attached on replay.
  const modelPrompt = stripSystemInstruction(prompt);
  const sentPrompt = promptForOutput !== modelPrompt && !task.mapPlace ? modelPrompt : '';
  const targetUrl = task.targetUrl ?? config.targetUrl;
  const preview = promptForOutput.length > 100 ? `${promptForOutput.slice(0, 100)}…` : promptForOutput;
  const providerLabel = getProviderLabel(targetUrl);

  // Sampled once: planning and delivery must agree even if the user toggles temporary chat
  // while the provider is still answering.
  const chatContext = resolveTaskChatContext(task, isTempChatMode());

  sendLog(`[${id}] 📤 ${task.source ?? 'ui'} → ${providerLabel}${chatContext.conversationPath ? ' (follow-up)' : ''}: "${preview}"`);

  const clipboardSnapshot = await backupClipboard();
  let lastError: unknown;
  // Kept for the finally: the clipboard is only put back if it is still holding this.
  let providerAnswer = '';
  // A hotkey answer handed back on the clipboard must not be "restored" away in the finally.
  let answerOnClipboard = false;

  try {
    const t0 = Date.now();
    sendLog(`[${id}] ⏳ Sending to ${providerLabel}...`);

    const planTurnFor = async (allowNative: boolean): Promise<ConversationSendPlan | null> => {
      const shared = {
        targetUrl,
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
    const plan = await planTurnFor(true);
    if (plan) {
      const { dropped, summarized } = plan.turnMeta;
      const detail = plan.mode === 'native'
        ? 'resuming the provider thread, nothing resent'
        : [
          `${plan.previousTurnCount} prior turn(s)`,
          summarized ? `${summarized} summarized` : '',
          dropped ? `${dropped} dropped` : '',
        ].filter(Boolean).join(', ');
      sendLog(`[${id}] 🧵 Context: ${plan.mode} — ${detail}`);
    }

    const isOpeningTurn = (plan?.previousTurnCount ?? 0) === 0;
    const needsTitle = isOpeningTurn && !task.title?.trim();
    const wantsTitleMarker = needsTitle && !providerNamesItsThread(targetUrl);
    if (wantsTitleMarker) {
      sendLog(`[${id}] 🏷️ ${providerLabel} has no thread title — asking the model to name this conversation`);
    }

    const memory = await resolveTaskMemory(task, chatContext.temporary);
    const dynamicInstruction = [
      buildCombinedPromptFromPrefs(resolvePromptPrefs(task), getLangCache()),
      taskMemoryInstruction(memory),
    ].filter(Boolean).join('\n');
    const recapWanted = wantsRecap(task);
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

    const runBrowserTask = async (
      outgoingPrompt: string,
      expectThreadUrl?: string,
    ): Promise<AutomationResult & { sentPrompt: string }> => {
      const preparedPrompt = preparePromptForProvider(outgoingPrompt, targetUrl);
      if (preparedPrompt.removedBlankLines) {
        sendLog(`[${id}] ✂️ Removed blank lines before sending to ${providerLabel}`);
      }
      if (preparedPrompt.truncated) {
        sendLog(`[${id}] ✂️ Prompt truncated to ${preparedPrompt.capLabel} for ${providerLabel}`);
      }

      return llmLane.runExclusive(async () => {
        const activeWorker = await ensureWorkerWindow(config.targetUrl, 'automation');
        if (!activeWorker || activeWorker.isDestroyed()) throw workerWindowUnavailable();
        const automated = await runAutomation(
          activeWorker,
          preparedPrompt.prompt,
          config.responseTimeout,
          targetUrl,
          task.attachments,
          expectThreadUrl,
          needsTitle,
        );
        return { ...automated, sentPrompt: preparedPrompt.prompt };
      });
    };

    // Taken before the send: an entry this very answer adds must count as newer than the thread.
    const sentAt = new Date().toISOString();
    // A native thread sees its own earlier recap lines, so the bare rule is enough there.
    const withNativeReminder = taskNativeReminder(memory, plan?.thread.threadAt, recapWanted ? [RECAP_RULE] : []);
    const sent = await executeConversationalSend({
      plan,
      targetUrl,
      userPrompt: prompt,
      replanAsReplay: () => planTurnFor(false),
      withInstruction,
      ...(withNativeReminder ? { withNativeReminder } : {}),
      runBrowser: runBrowserTask,
      runByok: (outgoing) => runByokCompletion(targetUrl, outgoing, config.responseTimeout),
      onThreadLost: () => sendLog(`[${id}] 🧵 Stored conversation thread is gone — continuing with a text recap`),
    });
    const stripMarker = !providerNamesItsThread(targetUrl);
    const { title: markerTitle, body: markedResponse } = stripMarker
      ? extractTitleMarker(sent.response)
      : { title: '', body: sent.response };
    // Whatever the source: a bot continuing a thread that once carried the rule may still write it.
    const { recap, body: recapStripped } = extractRecapLine(markedResponse);
    if (recap) sendLog(`[${id}] 📝 Recap updated`);
    else if (recapWanted) sendLog(`[${id}] 📝 Recap missing: no line in the reply, the previous one stays`);
    const { text: response, notes: memoryNotes } = await settleTaskMemory(
      sent.plan?.external ? { ...task, external: true } : task,
      memory,
      recapStripped,
      promptForOutput,
      chatContext.conversationPath,
    );
    providerAnswer = sent.response;
    const { title } = sent;
    if (markerTitle) sendLog(`[${id}] 🏷️ Model named this conversation "${markerTitle}"`);

    const elapsed = ((Date.now() - t0) / 1_000).toFixed(1);
    sendLog(`[${id}] ✅ Response received in ${elapsed}s (${response.length} chars)`);
    recordTaskOutcome('chat', 'success', task);

    const usage = sent.usage
      ? { input: sent.usage.input, output: sent.usage.output, exact: true }
      : estimateUsage(sent.outgoingPrompt, response);

    const attachedNames = attachmentMetaNames(task.attachments ?? []);
    const turnMeta: TurnMeta = {
      ...(sent.plan?.turnMeta ?? {}),
      p: providerLabel,
      t: new Date().toISOString(),
      d: Date.now() - t0,
      ...(attachedNames.length > 0 ? { a: attachedNames } : {}),
      ti: usage.input,
      to: usage.output,
      ...(usage.exact ? { tx: 1 as const } : {}),
      ...(memoryNotes.length > 0 ? { mem: memoryNotes } : {}),
      ...(sentPrompt ? { sent: sentPrompt } : {}),
      // A send that carried the rule but got no line keeps the previous recap; a send without the rule
      // (a bot) leaves a stop, since it may have moved the conversation silently.
      ...(recap ? { rc: recap } : recapWanted ? {} : { rc: '' }),
    };

    const outputDir = await getOutputDir();
    const langData = await loadLanguageData(config.locale);
    const providerHeaderLabel = langData?.['md.provider'] ?? 'Provider';
    const promptLabel = langData?.['md.prompt'] ?? 'Prompt';
    const responseLabel = langData?.['md.response'] ?? 'Response';
    const timestampLabel = langData?.['md.timestamp'] ?? 'Time';

    const promptFallback = titleFromPrompt(promptForOutput);
    const finalTitle = pickConversationTitle({
      resolved: task.title,
      marker: markerTitle,
      provider: stripSystemInstruction(title ?? ''),
      prompt: promptFallback,
    });

    const markdownOptions = {
      prompt: promptForOutput,
      response,
      title: finalTitle,
      provider: providerLabel,
      providerLabel: providerHeaderLabel,
      promptLabel,
      responseLabel,
      timestampLabel,
      turnMeta,
    };

    const temporaryReply = chatContext.temporary;
    let savedFileName = '';
    let conversationPath = '';
    if (temporaryReply) {
      deliverTempChatResult({
        content: buildOutputMarkdown(markdownOptions),
        turn: { prompt: promptForOutput, response, meta: turnMeta },
        ...(task.mapPlace ? { map: task.mapPlace } : {}),
      });
      sendLog(`[${id}] 👻 Temporary chat — reply not saved`);
    } else {
      conversationPath = await appendOrCreateConversation({
        plan: sent.plan,
        conversationPath: chatContext.conversationPath ?? undefined,
        markdownOptions,
        outputDir,
        prompt: promptForOutput,
        response,
        turnMeta,
        threadUrl: sent.threadUrl,
        targetUrl,
        onLog: (message) => sendLog(`[${id}] ${message}`),
        ...(sent.plan?.mode === 'native' ? {} : { threadAt: sentAt }),
        ...(task.mapPlace ? { map: task.mapPlace } : {}),
        ...(task.fileLabel ? { fileLabel: task.fileLabel } : {}),
      });
      savedFileName = path.basename(conversationPath);

      if (plan?.previousTurnCount === 0) {
        await upgradeConversationTitle(
          conversationPath,
          task.placeholderTitle ?? promptFallback,
          finalTitle,
        );
        await ensureConversationHeader(conversationPath, {
          provider: providerLabel,
          providerLabel: providerHeaderLabel,
          timestampLabel,
        });
      }

      if (task.sessionKey) await setBotConversation(task.sessionKey, conversationPath);

      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
    }

    if (claimChatTurnReport(task)) {
      sendToRenderer(IPC.CHAT_TURN, {
        sendId: task.sendId ?? '',
        conversationPath,
        phase: 'done',
        prompt: promptForOutput,
        response,
        meta: turnMeta,
      } satisfies ChatTurnEvent);
    }

    // Only the hotkey hands its answer back: a chat-window send ends with the answer on screen,
    // and bot tasks fire at arbitrary times — writing theirs would clobber whatever the user copied.
    if (task.source === 'hotkey' && task.clipboardFingerprint !== undefined) {
      answerOnClipboard = await handAnswerToClipboard(task.clipboardFingerprint, response, providerAnswer);
      sendLog(`[${id}] 📋 ${answerOnClipboard ? 'Reply copied to the clipboard' : 'Clipboard changed since the hotkey press — reply not copied'}`);
    }

    // Claim-gated like the failure path: a task the queue gave up on still runs to completion.
    // Only a focused chat-window (`ui`) send skips the banner, since its answer is already on screen;
    // hotkey, bot and unlabelled sends keep it.
    const answerAlreadyOnScreen = task.source === 'ui' && isMainWindowFocused();
    if (config.notifyEvents.chatComplete && !answerAlreadyOnScreen && claimLocalNotification(task)) {
      // Named by the conversation title, as the chat history lists it: the prompt can be a
      // machine-built template, and the file name is a timestamp nobody recognises.
      const strings = getLangCache();
      const bodyKey = answerOnClipboard
        ? 'notify.completed.copied.body'
        : temporaryReply
          ? 'notify.completed.unsaved.body'
          : 'notify.completed.saved.body';
      sendWebNotification(
        t(strings, 'notify.completed.title'),
        t(strings, bodyKey, { title: compactPreview(finalTitle, 36) }),
      );
    }

    if (claimRemoteReply(task)) {
      // A bot message has no place under the reply for the notes, so they ride at its end.
      const remoteResponse = withMemoryNotes(response, memoryNotes, (key, vars) => t(getLangCache(), key, vars));
      if (task.replyTarget) {
        await telegramRuntime.sendTaskSuccess(task.replyTarget, {
          providerLabel,
          savedFileName,
          response: remoteResponse,
          prompt: promptForOutput,
          title: finalTitle,
          elapsedSeconds: elapsed,
        });
      }
      if (task.lineReplyTarget) {
        await lineRuntime.sendTaskSuccess(task.lineReplyTarget.chatId, remoteResponse);
      }
    }
  } catch (err: unknown) {
    lastError = err;
    recordTaskOutcome('chat', classifyFailure(err instanceof Error ? err.message : String(err)), task);
    const strings = getLangCache();
    if (isLoginRequiredError(targetUrl, err)) {
      sendLog(`[${id}] ⚠️ Login required before sending prompt`);
      await replyRemoteError(task, deps, {
        providerLabel,
        message: t(strings, 'telegram.error.loginRequired'),
      });
      return;
    }
    const error = err as Error;
    const uploadFailure = parseUploadFailure(error.message ?? '');
    if (uploadFailure) {
      const { phase } = uploadFailure;
      const key = phase === 'not-signed-in'
        ? 'attach.upload.notSignedIn'
        : phase === 'gems-mode'
          ? 'attach.upload.gemsMode'
          : phase === 'rejected'
            ? 'attach.upload.rejected'
            : 'attach.upload.failed';
      const message = t(strings, key, { provider: providerLabel });
      sendWebNotification(t(strings, 'notify.chat.failure.title'), message, 'error');
      sendLog(`[${id}] ⚠️ attachment upload failed: ${phase}`);
      await replyRemoteError(task, deps, { providerLabel, message });
      return;
    }
    const rawMessage = error.message;
    sendLog(`[${id}] ❌ ${rawMessage}`);
    if (
      config.notifyEvents.chatFailure
      && error.name !== VERIFICATION_CHALLENGE_ERROR_NAME
      && claimLocalNotification(task)
    ) {
      const displayError = compactPreview(localizeUserFacingError(rawMessage, strings), 90);
      sendWebNotification(
        t(strings, 'notify.chat.failure.title'),
        t(strings, 'notify.chat.failure.body', { provider: providerLabel, error: displayError }),
        'error',
      );
    }
    await replyRemoteError(task, deps, {
      providerLabel,
      message: localizeUserFacingError(rawMessage, strings),
    });
  } finally {
    reportChatTurnFailure(task, localizeUserFacingError(
      lastError instanceof Error ? lastError.message : String(lastError ?? ''),
      getLangCache(),
    ));
    if (task.ephemeralAttachments && task.attachments?.length) {
      await deleteTempAttachments(task.attachments);
    }
    if (!answerOnClipboard) await restoreClipboardAfterTask(clipboardSnapshot, providerAnswer);
  }
}

export function notifyQueueLevelFailure(
  task: Task,
  err: unknown,
  deps: TaskProcessorDeps,
): Promise<void> {
  return reportQueueLevelFailure(task, err, deps, getProviderLabel, sendLog);
}
