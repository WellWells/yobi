import { config, saveConfig } from '../config';
import { llmLane } from '../flow/lanes';
import { FlowAbortError } from '../flow/runtime';
import { getLangCache, localizeUserFacingError } from '../i18n';
import { preparePromptForProvider, runAutomation } from '../providers';
import { runByokCompletion } from '../providers/byokClient';
import { ensureWorkerWindow } from '../windows';
import { workerWindowUnavailable } from '../workerWindowError';
import type { OneShotIo, OneShotPhase } from './oneShot';

/**
 * The quick-action model that rewriting and translation share: the one picked last, or the chat
 * model when none was (`config.writingToolsUrl` empty).
 */
export function quickActionModelUrl(): string {
  return config.writingToolsUrl.trim() || config.targetUrl;
}

/** Remembered only when it differs from what would be used anyway, so "follow the chat model" survives picking it. */
export function rememberQuickActionModel(providerUrl: string): void {
  if (providerUrl === quickActionModelUrl()) return;
  config.writingToolsUrl = providerUrl;
  saveConfig({ writingToolsUrl: providerUrl });
}

/**
 * The real channel for one one-off request. A browser provider gets a new chat in the worker
 * window, inside the window's queue — never `expectThreadUrl`, so nothing lands in a
 * conversation's own thread; a BYOK key is called directly.
 */
export function oneShotIo(signal: AbortSignal, onProgress: (phase: OneShotPhase) => void): OneShotIo {
  return {
    byokBudgetChars: config.byokContextBudgetChars,
    signal,
    onProgress,
    laneBusy: () => llmLane.busy,
    runBrowser: (providerUrl, prompt, onStart) => llmLane.runExclusive(async () => {
      // Cancelled while queued: never typed into the provider, so nothing lands in the user's history.
      if (signal.aborted) throw new FlowAbortError();
      onStart();
      const worker = await ensureWorkerWindow(providerUrl, 'automation');
      if (!worker || worker.isDestroyed()) throw workerWindowUnavailable();
      // Opening the window takes a while; a cancel in that time must still stop it before it types.
      if (signal.aborted) throw new FlowAbortError();
      const prepared = preparePromptForProvider(prompt, providerUrl);
      const automated = await runAutomation(worker, prepared.prompt, config.responseTimeout, providerUrl);
      return automated.response;
    }),
    runByok: async (providerUrl, prompt) => {
      const { response } = await runByokCompletion(providerUrl, prompt, config.responseTimeout, signal);
      return response;
    },
    describeError: (err) => localizeUserFacingError(err instanceof Error ? err.message : String(err), getLangCache()),
  };
}
