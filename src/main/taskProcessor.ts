import * as path from 'node:path';
import {
  runAutomation,
  getProviderLabel,
  preparePromptForProvider,
  isLoginRequiredError,
} from './providers';
import { runByokCompletion } from './providers/byokClient';
import { PERPLEXITY_CLOUDFLARE_ERROR_NAME } from './providers/perplexity';
import { VERIFICATION_CHALLENGE_ERROR_NAME } from './providers/verificationChallenge';
import { buildOutputMarkdown, saveOutput } from './output';
import { config } from './config';
import { deliverTempChatResult, isTempChatMode } from './tempChat';
import { IPC, isByokTargetUrl } from '../shared/types';
import type { PromptPreferences, Task } from '../shared/types';
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  clearPerplexitySiteDataIfNeeded,
  sanitizeRequesterName,
} from './helpers';
import { backupClipboard, restoreClipboard } from './clipboard';
import { TaskHardTimeoutError } from './queueManager';
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
import type { TelegramRuntime } from './telegram';
import type { LineRuntime } from './line';

export interface TaskProcessorDeps {
  telegramRuntime: TelegramRuntime;
  lineRuntime: LineRuntime;
}

// The nickname preference answers "what should the AI call *you*", where "you"
// is whoever sits at this desktop. A task arriving over a bot is addressed to
// the sender instead, so their display name takes that slot — and when no name
// came through, the prompt drops the form of address rather than greeting a
// stranger by the desktop owner's name.
function resolvePromptPrefs(task: Task): PromptPreferences {
  const isBotTask = task.source === 'telegram' || task.source === 'line';
  if (!isBotTask) return config.promptPreferences;
  return { ...config.promptPreferences, nickname: sanitizeRequesterName(task.requesterName) };
}

// A task that came in over a bot gets exactly one reply, whoever gets there
// first. Two writers race for it: processTask, and the queue's hard timeout —
// which does NOT cancel processTask, so without this the worker would later push
// its answer on top of a timeout notice the user had already been given.
const remotelyReported = new WeakSet<Task>();

// Desktop failure toasts race the same two writers (processTask's catch and the
// queue hard timeout, which does not cancel processTask) — dedupe them the same
// way bot replies are, or one task pops two error notifications.
const locallyNotified = new WeakSet<Task>();

function claimRemoteReply(task: Task): boolean {
  if (!task.replyTarget && !task.lineReplyTarget) return false;
  if (remotelyReported.has(task)) return false;
  remotelyReported.add(task);
  return true;
}

async function replyRemoteError(
  task: Task,
  deps: TaskProcessorDeps,
  payload: { providerLabel: string; message: string },
): Promise<void> {
  if (!claimRemoteReply(task)) return;
  if (task.replyTarget) await deps.telegramRuntime.sendTaskError(task.replyTarget, payload);
  if (task.lineReplyTarget) await deps.lineRuntime.sendTaskError(task.lineReplyTarget.chatId, payload);
}

export async function processTask(task: Task, deps: TaskProcessorDeps): Promise<void> {
  const { telegramRuntime, lineRuntime } = deps;
  const { id, prompt } = task;
  const promptForOutput = stripSystemInstruction(prompt);
  const targetUrl = task.targetUrl ?? config.targetUrl;
  const preview = prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt;
  const providerLabel = getProviderLabel(targetUrl);

  sendLog(`[${id}] 📤 "${preview}"`);

  const clipboardSnapshot = backupClipboard();
  let preservePerplexitySiteData = false;

  try {
    const t0 = Date.now();
    sendLog(`[${id}] ⏳ Sending to ${providerLabel}...`);

    const dynamicInstruction = buildCombinedPromptFromPrefs(resolvePromptPrefs(task), getLangCache());
    const instruction = buildTaskInstruction(dynamicInstruction, config.syncSystemLanguageToModel, config.locale);
    const fullPrompt = instruction ? `${instruction}\n\n${prompt}` : prompt;

    const runBrowserTask = async (): Promise<{ response: string; title: string }> => {
      const preparedPrompt = preparePromptForProvider(fullPrompt, targetUrl);
      if (preparedPrompt.removedBlankLines) {
        sendLog(`[${id}] ✂️ Removed blank lines before sending to ${providerLabel}`);
      }
      if (preparedPrompt.truncated) {
        sendLog(`[${id}] ✂️ Prompt truncated to ${preparedPrompt.maxChars} chars for ${providerLabel}`);
      }

      // Resolve the worker window INSIDE the lane: while queued behind other
      // automations the window can be destroyed/recreated (login/Cloudflare mode
      // switch), so a reference captured earlier may be dead by the time we run.
      return llmLane.runExclusive(async () => {
        // Resolve the worker inside the lane so a concurrent login/Cloudflare mode
        // switch can't swap the window mid-run. ensureWorkerWindow forces
        // 'automation' mode, reclaiming a worker left interactive after a prior
        // login so streamed replies don't stall in a hidden, unspoofed window.
        const activeWorker = await ensureWorkerWindow(config.targetUrl, 'automation');
        if (!activeWorker || activeWorker.isDestroyed()) {
          throw new Error('Worker window unavailable after relaunch attempt');
        }
        return runAutomation(
          activeWorker,
          preparedPrompt.prompt,
          config.responseTimeout,
          targetUrl,
          task.attachments,
        );
      });
    };

    // BYOK targets are direct HTTP API calls: no worker window, no llmLane
    // serialization, and the prompt goes through verbatim (no truncation).
    const { response, title } = isByokTargetUrl(targetUrl)
      ? await runByokCompletion(targetUrl, fullPrompt, config.responseTimeout)
      : await runBrowserTask();

    const elapsed = ((Date.now() - t0) / 1_000).toFixed(1);
    sendLog(`[${id}] ✅ Response received in ${elapsed}s`);
    recordTaskOutcome('chat', 'success', task);

    const outputDir = await getOutputDir();
    const langData = await loadLanguageData(config.locale);
    const providerHeaderLabel = langData?.['md.provider'] ?? 'Provider';
    const promptLabel = langData?.['md.prompt'] ?? 'Prompt';
    const responseLabel = langData?.['md.response'] ?? 'Response';
    const timestampLabel = langData?.['md.timestamp'] ?? 'Time';

    const geminiTitle = stripSystemInstruction(title?.trim() ?? '').replace(/\s+/g, ' ').trim();
    const taskTitle = task.title?.trim().replace(/\s+/g, ' ') ?? '';
    const promptFallback = promptForOutput.trim().replace(/\s+/g, ' ').slice(0, 70);
    const finalTitle = taskTitle || geminiTitle || promptFallback || 'Untitled';

    const markdownOptions = {
      prompt: promptForOutput,
      response,
      title: finalTitle,
      provider: providerLabel,
      providerLabel: providerHeaderLabel,
      promptLabel,
      responseLabel,
      timestampLabel,
    };

    // Temporary chat mode: no .md file, no file-list broadcast — the reply is
    // pushed to the renderer in memory only. Remote-originated tasks (Telegram,
    // LINE) are exempt (the mode covers local traces; remote replies still need
    // a file to export/reference).
    const temporaryReply = isTempChatMode() && !task.replyTarget && !task.lineReplyTarget;
    let savedFileName = '';
    if (temporaryReply) {
      deliverTempChatResult({ content: buildOutputMarkdown(markdownOptions) });
      sendLog(`[${id}] 👻 Temporary chat — reply not saved`);
    } else {
      const filePath = await saveOutput({ ...markdownOptions, outputDir });
      savedFileName = path.basename(filePath);
      sendLog(`[${id}] 💾 Saved: ${savedFileName}`);

      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
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
    recordTaskOutcome('chat', classifyFailure(err instanceof Error ? err.message : String(err)), task);
    const strings = getLangCache();
    if (isLoginRequiredError(targetUrl, err)) {
      // The provider already revealed the interactive login window (chat + flow);
      // here we only log and notify the remote (Telegram) caller.
      // Keep the site data: the cleanup below would drop the sign-in page's CSRF cookie
      // out from under the login the user was just asked to complete.
      preservePerplexitySiteData = true;
      sendLog(`[${id}] ⚠️ Login required before sending prompt`);
      await replyRemoteError(task, deps, {
        providerLabel,
        message: t(strings, 'telegram.error.loginRequired'),
      });
      return;
    }
    const error = err as Error;
    const uploadMatch = /^gemini-upload\[([^\]]+)\]/.exec(error.message ?? '');
    if (uploadMatch) {
      const phase = uploadMatch[1];
      const key = phase === 'not-signed-in'
        ? 'attach.upload.notSignedIn'
        : phase === 'gems-mode'
          ? 'attach.upload.gemsMode'
          : 'attach.upload.failed';
      sendWebNotification(t(strings, 'app.name'), t(strings, key), 'error');
      sendLog(`[${id}] ⚠️ attachment upload failed: ${phase}`);
      await replyRemoteError(task, deps, { providerLabel, message: t(strings, key) });
      return;
    }
    if (error.name === PERPLEXITY_CLOUDFLARE_ERROR_NAME) {
      preservePerplexitySiteData = true;
    }
    const rawMessage = error.message;
    sendLog(`[${id}] ❌ ${rawMessage}`);
    // Verification challenges already notified at raise time (with an "open
    // worker window" action) — a second generic failure toast would duplicate it.
    if (config.notifyEvents.chatFailure && error.name !== VERIFICATION_CHALLENGE_ERROR_NAME && !locallyNotified.has(task)) {
      locallyNotified.add(task);
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
    restoreClipboard(clipboardSnapshot);
    if (!preservePerplexitySiteData) {
      await clearPerplexitySiteDataIfNeeded(targetUrl);
    }
  }
}

// The queue's hard timeout rejects its own race, outside processTask's try/catch,
// so a remote caller would sit waiting for a reply that never arrives. Every
// queue-level rejection reports back on whichever bot asked for the task, and
// claimRemoteReply guarantees the still-running worker cannot contradict it.
export async function notifyQueueLevelFailure(
  task: Task,
  err: unknown,
  deps: TaskProcessorDeps,
): Promise<void> {
  const strings = getLangCache();
  const message = err instanceof TaskHardTimeoutError
    ? t(strings, 'main.error.taskTimeout', { minutes: String(err.timeoutMinutes) })
    : localizeUserFacingError(err instanceof Error ? err.message : String(err), strings);

  sendLog(`[${task.id}] ❌ ${message}`);

  // A hotkey or in-app task has no chat to answer, and processTask's own failure
  // toast lives in a catch the timeout never reaches — so it would vanish in
  // silence. Surface it on the desktop instead.
  if (!task.replyTarget && !task.lineReplyTarget) {
    if (config.notifyEvents.chatFailure && !locallyNotified.has(task)) {
      locallyNotified.add(task);
      sendWebNotification(t(strings, 'notify.chat.failure.title'), message, 'error');
    }
    return;
  }

  const providerLabel = getProviderLabel(task.targetUrl ?? config.targetUrl);
  try {
    await replyRemoteError(task, deps, { providerLabel, message });
  } catch (notifyErr: unknown) {
    sendLog(`[${task.id}] ⚠️ failed to report the queue-level failure: ${(notifyErr as Error).message}`);
  }
}
