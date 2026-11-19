import { IPC, isByokTargetUrl } from '../shared/types';
import { config, saveConfig } from './config';
import { llmLane } from './flow/lanes';
import { normalizeAiUrl, sendLog, sendToRenderer } from './helpers';
import { getProviderLabel } from './providers';
import { getWorkerWin } from './windows';

/**
 * Sets the chat's default model: saved, the AI worker moved to it (a web model), and the window told,
 * so a change from Settings and one from the Yobi connector land the same way. Returns the URL kept.
 */
export function setChatTarget(nextUrl: string): string {
  const normalized = normalizeAiUrl(nextUrl);
  config.targetUrl = normalized;
  saveConfig({ targetUrl: normalized });
  if (!isByokTargetUrl(normalized)) {
    void llmLane.runExclusive(async () => {
      const worker = getWorkerWin();
      if (!worker || worker.isDestroyed() || config.targetUrl !== normalized) return;
      await worker.loadURL(normalized).catch(() => undefined);
    });
  }
  sendLog(`🌐 AI target updated: ${getProviderLabel(normalized)}`);
  sendToRenderer(IPC.AI_URL_CHANGED, normalized);
  return normalized;
}
