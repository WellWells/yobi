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
import { appendOrCreateConversation } from './chat/conversationPersist';
import {
  claimChatTurnReport,
  claimLocalNotification,
  claimRemoteReply,
  notifyQueueLevelFailure as reportQueueLevelFailure,
  reportChatTurnFailure,
  replyRemoteError,
} from './taskReporting';
import type { TaskReportDeps } from './taskReporting';
import { PERPLEXITY_CLOUDFLARE_ERROR_NAME } from './providers/perplexity';
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
import { IPC, isByokTargetUrl, providerFromUrl } from '../shared/types';
import type { ChatTurnEvent, PromptPreferences, Task } from '../shared/types';
import { extractTitleMarker, pickConversationTitle } from '../shared/conversationTitle';
import type { TurnMeta } from '../shared/conversationDoc';
import { attachmentMetaNames } from '../shared/conversationDoc';
import { estimateUsage } from '../shared/tokenEstimate';
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  clearPerplexitySiteDataIfNeeded,
  sanitizeRequesterName,
} from './helpers';
import { setBotConversation } from './botConversations';
import { deleteTempAttachments } from './telegram/fileDownload';
import { backupClipboard, restoreClipboard } from './clipboard';
import { classifyFailure, recordTaskOutcome } from './metrics';
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

export type TaskProcessorDeps = TaskReportDeps;

function resolvePromptPrefs(task: Task): PromptPreferences {
  const isBotTask = task.source === 'telegram' || task.source === 'line';
  if (!isBotTask) return config.promptPreferences;
  return { ...config.promptPreferences, nickname: sanitizeRequesterName(task.requesterName) };
}

function providerNamesItsThread(targetUrl: string): boolean {
  return !isByokTargetUrl(targetUrl) && providerFromUrl(targetUrl) !== 'duckai';
}

export async function processTask(task: Task, deps: TaskProcessorDeps): Promise<void> {
  const { telegramRuntime, lineRuntime } = deps;
  const { id, prompt } = task;
  const promptForOutput = task.displayPrompt?.trim() ? task.displayPrompt.trim() : stripSystemInstruction(prompt);
  const targetUrl = task.targetUrl ?? config.targetUrl;
  const preview = promptForOutput.length > 100 ? `${promptForOutput.slice(0, 100)}…` : promptForOutput;
  const providerLabel = getProviderLabel(targetUrl);

  sendLog(`[${id}] 📤 ${task.source ?? 'ui'} → ${providerLabel}${task.conversationPath ? ' (follow-up)' : ''}: "${preview}"`);

  const clipboardSnapshot = backupClipboard();
  let preservePerplexitySiteData = false;
  let lastError: unknown;

  try {
    const t0 = Date.now();
    sendLog(`[${id}] ⏳ Sending to ${providerLabel}...`);

    const planTurnFor = async (allowNative: boolean): Promise<ConversationSendPlan | null> => {
      const shared = { targetUrl, userPrompt: prompt, timeoutMs: config.responseTimeout, allowNative };
      if (task.conversationPath) {
        return planConversationSend({ conversationPath: task.conversationPath, ...shared });
      }
      const tempDoc = isTempChatMode() ? await getTempChatConversation() : null;
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

    const dynamicInstruction = buildCombinedPromptFromPrefs(resolvePromptPrefs(task), getLangCache());
    const instruction = buildTaskInstruction(
      dynamicInstruction,
      config.syncSystemLanguageToModel,
      config.locale,
      wantsTitleMarker ? [t(getLangCache(), 'chat.title.markerRule')] : [],
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
        if (!activeWorker || activeWorker.isDestroyed()) {
          throw new Error('Worker window unavailable after relaunch attempt');
        }
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

    const sent = await executeConversationalSend({
      plan,
      targetUrl,
      userPrompt: prompt,
      replanAsReplay: () => planTurnFor(false),
      withInstruction,
      runBrowser: runBrowserTask,
      runByok: (outgoing) => runByokCompletion(targetUrl, outgoing, config.responseTimeout),
      onThreadLost: () => sendLog(`[${id}] 🧵 Stored conversation thread is gone — continuing with a text recap`),
    });
    const stripMarker = !providerNamesItsThread(targetUrl);
    const { title: markerTitle, body: response } = stripMarker
      ? extractTitleMarker(sent.response)
      : { title: '', body: sent.response };
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
      ...(attachedNames.length > 0 ? { a: attachedNames } : {}),
      ti: usage.input,
      to: usage.output,
      ...(usage.exact ? { tx: 1 as const } : {}),
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

    const temporaryReply = isTempChatMode() && !task.replyTarget && !task.lineReplyTarget;
    let savedFileName = '';
    let conversationPath = '';
    if (temporaryReply) {
      deliverTempChatResult({
        content: buildOutputMarkdown(markdownOptions),
        turn: { prompt: promptForOutput, response, meta: turnMeta },
      });
      sendLog(`[${id}] 👻 Temporary chat — reply not saved`);
    } else {
      conversationPath = await appendOrCreateConversation({
        plan: sent.plan,
        conversationPath: task.conversationPath,
        markdownOptions,
        outputDir,
        prompt: promptForOutput,
        response,
        turnMeta,
        threadUrl: sent.threadUrl,
        targetUrl,
        onLog: (message) => sendLog(`[${id}] ${message}`),
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

    if (config.notifyEvents.chatComplete) {
      const notifyTitle = langData?.['notify.completed.title'] ?? 'Yobi';
      const notifyBodyTemplate = temporaryReply
        ? (langData?.['notify.completed.temp.body'] ?? '"{{prompt}}" — temporary chat, not saved')
        : (langData?.['notify.completed.body'] ?? '"{{prompt}}" saved as {{file}}');
      const compactPrompt = promptForOutput.replace(/\s+/g, ' ').trim().slice(0, 36);
      const displayPrompt = compactPrompt.length < promptForOutput.replace(/\s+/g, ' ').trim().length
        ? `${compactPrompt}…`
        : compactPrompt;
      sendWebNotification(
        notifyTitle,
        notifyBodyTemplate.replace('{{prompt}}', displayPrompt).replace('{{file}}', savedFileName),
      );
    }

    if (claimRemoteReply(task)) {
      if (task.replyTarget) {
        await telegramRuntime.sendTaskSuccess(task.replyTarget, {
          providerLabel,
          savedFileName,
          response,
          prompt: promptForOutput,
          title: finalTitle,
          elapsedSeconds: elapsed,
        });
      }
      if (task.lineReplyTarget) {
        await lineRuntime.sendTaskSuccess(task.lineReplyTarget.chatId, response);
      }
    }
  } catch (err: unknown) {
    lastError = err;
    recordTaskOutcome('chat', classifyFailure(err instanceof Error ? err.message : String(err)), task);
    const strings = getLangCache();
    if (isLoginRequiredError(targetUrl, err)) {
      preservePerplexitySiteData = true;
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
      sendWebNotification(t(strings, 'app.name'), message, 'error');
      sendLog(`[${id}] ⚠️ attachment upload failed: ${phase}`);
      await replyRemoteError(task, deps, { providerLabel, message });
      return;
    }
    if (error.name === PERPLEXITY_CLOUDFLARE_ERROR_NAME) {
      preservePerplexitySiteData = true;
    }
    const rawMessage = error.message;
    sendLog(`[${id}] ❌ ${rawMessage}`);
    if (
      config.notifyEvents.chatFailure
      && error.name !== VERIFICATION_CHALLENGE_ERROR_NAME
      && claimLocalNotification(task)
    ) {
      const compactError = localizeUserFacingError(rawMessage, strings).replace(/\s+/g, ' ').trim();
      const displayError = compactError.length > 90 ? `${compactError.slice(0, 90)}…` : compactError;
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
    restoreClipboard(clipboardSnapshot);
    if (!preservePerplexitySiteData) {
      await clearPerplexitySiteDataIfNeeded(targetUrl);
    }
  }
}

export function notifyQueueLevelFailure(
  task: Task,
  err: unknown,
  deps: TaskProcessorDeps,
): Promise<void> {
  return reportQueueLevelFailure(task, err, deps, getProviderLabel, sendLog);
}
