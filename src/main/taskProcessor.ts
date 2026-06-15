import * as path from 'node:path';
import {
  runAutomation,
  getProviderLabel,
  preparePromptForProvider,
  isLoginRequiredError,
  getProviderLoginUrl,
} from './providers';
import { PERPLEXITY_CLOUDFLARE_ERROR_NAME } from './providers/perplexity';
import { saveOutput } from './output';
import { config } from './config';
import { IPC } from '../shared/types';
import type { Task } from '../shared/types';
import {
  sendLog,
  sendToRenderer,
  sendWebNotification,
  clearPerplexitySiteDataIfNeeded,
} from './helpers';
import { backupClipboard, restoreClipboard } from './clipboard';
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
import {
  createWorkerWindow,
  getWorkerWin,
  showLoginWindowIfNeeded,
} from './windows';
import type { TelegramRuntime } from './telegram';

export interface TaskProcessorDeps {
  telegramRuntime: TelegramRuntime;
}

export async function processTask(task: Task, deps: TaskProcessorDeps): Promise<void> {
  const { telegramRuntime } = deps;
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

    const dynamicInstruction = buildCombinedPromptFromPrefs(config.promptPreferences, getLangCache());
    const instruction = buildTaskInstruction(dynamicInstruction, config.syncSystemLanguageToModel, config.locale);
    const fullPrompt = instruction ? `${instruction}\n\n${prompt}` : prompt;
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
    const { response, title } = await llmLane.runExclusive(async () => {
      let activeWorker = getWorkerWin();
      if (!activeWorker || activeWorker.isDestroyed()) {
        sendLog(`[${id}] 🔄 Relaunching worker window...`);
        createWorkerWindow(config.targetUrl);
        await new Promise((r) => setTimeout(r, 3_000));
        activeWorker = getWorkerWin();
      }
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

    const elapsed = ((Date.now() - t0) / 1_000).toFixed(1);
    sendLog(`[${id}] ✅ Response received in ${elapsed}s`);

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

    const filePath = await saveOutput({
      prompt: promptForOutput,
      response,
      outputDir,
      title: finalTitle,
      provider: providerLabel,
      providerLabel: providerHeaderLabel,
      promptLabel,
      responseLabel,
      timestampLabel,
    });
    const savedFileName = path.basename(filePath);
    sendLog(`[${id}] 💾 Saved: ${savedFileName}`);

    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());

    const notifyTitle = langData?.['notify.completed.title'] ?? 'Yobi';
    const notifyBodyTemplate = langData?.['notify.completed.body'] ?? '"{{prompt}}" saved as {{file}}';
    const compactPrompt = promptForOutput.replace(/\s+/g, ' ').trim().slice(0, 36);
    const displayPrompt = compactPrompt.length < promptForOutput.replace(/\s+/g, ' ').trim().length
      ? `${compactPrompt}…`
      : compactPrompt;
    sendWebNotification(
      notifyTitle,
      notifyBodyTemplate.replace('{{prompt}}', displayPrompt).replace('{{file}}', savedFileName),
    );

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
  } catch (err: unknown) {
    const strings = getLangCache();
    if (isLoginRequiredError(targetUrl, err)) {
      const loginUrl = getProviderLoginUrl(targetUrl);
      if (loginUrl) await showLoginWindowIfNeeded(providerLabel, loginUrl);
      sendLog(`[${id}] ⚠️ Login required before sending prompt`);
      if (task.replyTarget) {
        await telegramRuntime.sendTaskError(task.replyTarget, {
          providerLabel,
          message: t(strings, 'telegram.error.loginRequired'),
        });
      }
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
      if (task.replyTarget) {
        await telegramRuntime.sendTaskError(task.replyTarget, {
          providerLabel,
          message: t(strings, key),
        });
      }
      return;
    }
    if (error.name === PERPLEXITY_CLOUDFLARE_ERROR_NAME) {
      preservePerplexitySiteData = true;
    }
    const rawMessage = error.message;
    sendLog(`[${id}] ❌ ${rawMessage}`);
    if (task.replyTarget) {
      await telegramRuntime.sendTaskError(task.replyTarget, {
        providerLabel,
        message: localizeUserFacingError(rawMessage, strings),
      });
    }
  } finally {
    restoreClipboard(clipboardSnapshot);
    if (!preservePerplexitySiteData) {
      await clearPerplexitySiteDataIfNeeded(targetUrl);
    }
  }
}
