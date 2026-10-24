import * as path from 'node:path';
import { getProviderLabel, isLoginRequiredError } from './providers';
import { answerTextWithPictures, keepAnswerPictures, sendAnswerToTelegram } from './chat/answerPictures';
import { providerNamesItsThread, sendTaskTo } from './chat/taskSend';
import { resolveTaskChatContext } from './chat/taskChatContext';
import { appendOrCreateConversation } from './chat/conversationPersist';
import { resolveTaskMemory, settleTaskMemory } from './chat/taskMemory';
import { wantsRecap } from './chat/recapPrompt';
import { extractRecapLine } from './chat/recapLine';
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
import { deliverTempChatResult, isTempChatMode } from './tempChat';
import { IPC, PROVIDER_LABELS, isByokTargetUrl } from '../shared/types';
import { looksLikeImageRequest } from '../shared/imageRequest';
import { providerSwitchNotice } from '../shared/providerFallback';
import {
  describeFallbackFailure,
  nextFallbackProviders,
  sendWithProviderFallback,
  taskMayFallBack,
} from './providerFallback';
import type { ChatTurnEvent, Task } from '../shared/types';
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
} from './helpers';
import { setBotConversation } from './botConversations';
import { deleteTempAttachments } from './telegram/fileDownload';
import { backupClipboard, handAnswerToClipboard, restoreClipboardAfterTask } from './clipboard';
import { classifyFailure, recordTaskOutcome } from './metrics';
import { runInMetricDomain } from './llmMeter';
import { listOutputFiles, getOutputDir } from './files';
import {
  loadLanguageData,
  getLangCache,
  localizeUserFacingError,
  stripSystemInstruction,
  t,
} from './i18n';

export type TaskProcessorDeps = TaskReportDeps;

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
  // Both move when another provider takes the message: from then on they name the one that answered
  // (or the one whose error is reported).
  let targetUrl = task.targetUrl ?? config.targetUrl;
  const preview = promptForOutput.length > 100 ? `${promptForOutput.slice(0, 100)}…` : promptForOutput;
  let providerLabel = getProviderLabel(targetUrl);
  // Which providers the message was moved to or tried, said after the error; '' when it never moved.
  let fallbackNote = '';

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

    const sendContext = {
      task,
      chatContext,
      memory: await resolveTaskMemory(task, chatContext.temporary),
      recapWanted: wantsRecap(task),
    };
    const { memory, recapWanted } = sendContext;

    const mayFallBack = taskMayFallBack(task, targetUrl, config.providerFallback);
    const candidateNeeds = {
      hidden: config.hiddenProviders,
      attachmentCount: task.attachments?.length ?? 0,
      imageRequest: mayFallBack && looksLikeImageRequest(promptForOutput),
      temporary: chatContext.temporary,
    };
    const outcome = await sendWithProviderFallback({
      targetUrl,
      enabled: mayFallBack,
      send: (sendUrl) => sendTaskTo(sendContext, sendUrl),
      candidates: (tried) => nextFallbackProviders(tried, candidateNeeds),
      onSwitch: (failed, next) => sendLog(
        `[${id}] 🔀 ${PROVIDER_LABELS[failed.provider]} gave no answer (${failed.reason}) — sending it to ${PROVIDER_LABELS[next]} instead`,
      ),
    });
    targetUrl = outcome.targetUrl;
    providerLabel = getProviderLabel(targetUrl);
    if (!outcome.ok) {
      fallbackNote = describeFallbackFailure(outcome, (key) => t(getLangCache(), key));
      throw outcome.error;
    }
    const { plan, sent, sentAt, byokImages } = outcome.value;
    const providerSwitch = outcome.switched;
    if (providerSwitch) {
      sendLog(`[${id}] 🔀 Answered by ${providerLabel} instead of ${PROVIDER_LABELS[providerSwitch.f]} (${providerSwitch.r})`);
    }
    const stripMarker = !providerNamesItsThread(targetUrl);
    const { title: markerTitle, body: markedResponse } = stripMarker
      ? extractTitleMarker(sent.response)
      : { title: '', body: sent.response };
    // Whatever the source: a bot continuing a thread that once carried the rule may still write it.
    const { recap, body: recapStripped } = extractRecapLine(markedResponse);
    if (recap) sendLog(`[${id}] 📝 Recap updated`);
    else if (recapWanted) sendLog(`[${id}] 📝 Recap missing: no line in the reply, the previous one stays`);
    const { text: settledText, notes: memoryNotes } = await settleTaskMemory(
      sent.plan?.external ? { ...task, external: true } : task,
      memory,
      recapStripped,
      promptForOutput,
      chatContext.conversationPath,
    );
    // Shown under the answer from the chat's media folder, the way a pasted post's photos are.
    const pictures = await keepAnswerPictures(sent.images, providerLabel);
    if (pictures.length > 0) sendLog(`[${id}] 🖼️ ${pictures.length} picture(s) kept under the answer`);
    const response = answerTextWithPictures(settledText, pictures.length, getLangCache());
    providerAnswer = sent.response;
    const { title } = sent;
    if (markerTitle) sendLog(`[${id}] 🏷️ Model named this conversation "${markerTitle}"`);

    const elapsed = ((Date.now() - t0) / 1_000).toFixed(1);
    sendLog(`[${id}] ✅ Response received in ${elapsed}s (${response.length} chars)`);
    recordTaskOutcome('chat', 'success', task);

    const usage = sent.usage
      ? { input: sent.usage.input, output: sent.usage.output, exact: true }
      : estimateUsage(sent.outgoingPrompt, response);

    // Only what the model was given: a BYOK key gets at most its picture limit, or nothing.
    const sentAttachments = isByokTargetUrl(targetUrl)
      ? (task.attachments ?? []).slice(0, byokImages?.length ?? 0)
      : task.attachments ?? [];
    const attachedNames = attachmentMetaNames(sentAttachments);
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
      ...(pictures.length > 0 ? { mv: pictures } : {}),
      ...(providerSwitch ? { sw: providerSwitch } : {}),
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
      // The marker sets the log colour: green only for a reply that really landed.
      sendLog(answerOnClipboard
        ? `[${id}] 📋 Reply copied to the clipboard`
        : `[${id}] ℹ️ Clipboard changed since the hotkey press — reply not copied`);
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
      const body = t(strings, bodyKey, { title: compactPreview(finalTitle, 36) });
      // Another service than the one the user picked answered: the banner says so first.
      const switchNotice = providerSwitch ? providerSwitchNotice(providerSwitch, providerLabel, (key) => t(strings, key)) : '';
      sendWebNotification(
        t(strings, 'notify.completed.title'),
        switchNotice ? `${switchNotice}\n${body}` : body,
      );
    }

    if (claimRemoteReply(task)) {
      // A bot message has no place under the reply for the notes, so they ride at its end.
      const remoteResponse = withMemoryNotes(response, memoryNotes, (key, vars) => t(getLangCache(), key, vars));
      const replyTarget = task.replyTarget;
      if (replyTarget) {
        const sendText = (): Promise<void> => telegramRuntime.sendTaskSuccess(replyTarget, {
          providerLabel,
          savedFileName,
          response: remoteResponse,
          prompt: promptForOutput,
          title: finalTitle,
          elapsedSeconds: elapsed,
        });
        await sendAnswerToTelegram(telegramRuntime, replyTarget, remoteResponse, pictures, getLangCache(), sendText);
      }
      if (task.lineReplyTarget) {
        await lineRuntime.sendTaskSuccess(task.lineReplyTarget.chatId, remoteResponse);
      }
    }
  } catch (err: unknown) {
    lastError = err;
    recordTaskOutcome('chat', classifyFailure(err instanceof Error ? err.message : String(err)), task);
    const strings = getLangCache();
    const withFallbackNote = (message: string): string => (fallbackNote ? `${message}\n${fallbackNote}` : message);
    if (isLoginRequiredError(targetUrl, err)) {
      sendLog(`[${id}] ⚠️ Login required before sending prompt`);
      // The sign-in window says what to do; only the providers also tried need a banner of their own.
      if (fallbackNote && config.notifyEvents.chatFailure && claimLocalNotification(task)) {
        sendWebNotification(
          t(strings, 'notify.chat.failure.title'),
          withFallbackNote(t(strings, 'notify.chat.failure.body', {
            provider: providerLabel,
            error: compactPreview(localizeUserFacingError((err as Error)?.message ?? String(err), strings), 90),
          })),
          'error',
        );
      }
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
      sendWebNotification(t(strings, 'notify.chat.failure.title'), withFallbackNote(message), 'error');
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
        withFallbackNote(t(strings, 'notify.chat.failure.body', { provider: providerLabel, error: displayError })),
        'error',
      );
    }
    await replyRemoteError(task, deps, {
      providerLabel,
      message: localizeUserFacingError(rawMessage, strings),
    });
  } finally {
    const failure = localizeUserFacingError(
      lastError instanceof Error ? lastError.message : String(lastError ?? ''),
      getLangCache(),
    );
    reportChatTurnFailure(task, fallbackNote ? `${failure}\n${fallbackNote}` : failure);
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
