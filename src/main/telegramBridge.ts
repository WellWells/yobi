import type {
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
} from '../shared/types';
import { normalizePairingState } from './telegram';
import { config, saveConfig } from './config';
import { maskToken, sendLog } from './helpers';
import { getLangCache, localizeUserFacingError, t } from './i18n';
import { captureMarkdownDocument, buildCaptureSummary } from './capture';
import { buildSafeFileNameFromTitle, getOutputDir, getUniquePath } from './files';
import type { QueueManager } from './queueManager';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

let _telegramRuntimeSnapshot: TelegramRuntimeSnapshot = {
  status: 'idle',
  updatedAt: new Date().toISOString(),
};

export function getTelegramRuntimeSnapshot(): TelegramRuntimeSnapshot {
  return _telegramRuntimeSnapshot;
}

export function setTelegramRuntimeSnapshot(snapshot: TelegramRuntimeSnapshot): void {
  _telegramRuntimeSnapshot = snapshot;
}

export function isTelegramAdminUser(userId: number): boolean {
  if (!Number.isFinite(userId) || userId <= 0) return false;
  return config.telegram.adminUserIds
    .filter((id) => Number.isFinite(id) && id > 0)
    .includes(userId);
}

export function buildTelegramSettingsSnapshot(): TelegramSettingsSnapshot {
  const normalizedPairing = normalizePairingState(config.telegram.pairing);
  const pairedSet = new Set(normalizedPairing.pairedUsers.map((user) => user.userId));
  const normalizedAdmins = [...new Set(
    config.telegram.adminUserIds.filter((userId) => Number.isFinite(userId) && userId > 0 && pairedSet.has(userId)),
  )];

  if (normalizedPairing.pendingCodes.length !== config.telegram.pairing.pendingCodes.length) {
    config.telegram.pairing = normalizedPairing;
    saveConfig({ telegram: config.telegram });
  }
  if (normalizedAdmins.length !== config.telegram.adminUserIds.length) {
    config.telegram.adminUserIds = normalizedAdmins;
    saveConfig({ telegram: config.telegram });
  }

  return {
    enabled: config.telegram.enabled,
    hasToken: Boolean(config.telegram.botToken.trim()),
    tokenPreview: maskToken(config.telegram.botToken),
    allowGroupCommands: config.telegram.allowGroupCommands,
    defaultReplyMode: config.telegram.defaultReplyMode,
    adminUserIds: normalizedAdmins,
    providerCommands: config.telegram.providerCommands,
    runtime: _telegramRuntimeSnapshot,
    pairing: normalizedPairing,
  };
}

export function buildTelegramStatusText(queue: QueueManager): string {
  const s = getLangCache();

  const queueState = queue.getState();
  const runtime = _telegramRuntimeSnapshot.status;
  const runtimeLabel = s[`settings.telegram.status.${runtime}`] ?? runtime;
  const queueStatusLabel = s[`status.${queueState.status}`] ?? queueState.status;
  const active = queueState.items.find((item) => item.status === 'running');
  const pendingCount = queueState.items.filter((item) => item.status === 'queued').length;
  const runningNone = t(s, 'telegram.status.runningNone');

  return [
    t(s, 'telegram.status.header'),
    t(s, 'telegram.status.runtime', { status: runtimeLabel }),
    t(s, 'telegram.status.queue', { status: queueStatusLabel }),
    t(s, 'telegram.status.running', {
      task: active ? `${active.id} — ${active.promptSummary}` : runningNone,
    }),
    t(s, 'telegram.status.queued', { count: `${pendingCount}` }),
  ].join('\n');
}

export async function exportTelegramResultDocument(request: {
  format: 'png' | 'webp' | 'pdf';
  providerLabel: string;
  savedFileName: string;
  prompt: string;
  response: string;
  title: string;
}): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  try {
    const captureResult = await captureMarkdownDocument({
      payload: {
        title: request.title || request.savedFileName.replace(/\.md$/i, ''),
        prompt: request.prompt,
        content: request.response,
        summary: buildCaptureSummary(request.response),
        provider: request.providerLabel,
        timestamp: new Date().toLocaleString(),
      },
      options: {
        mode: 'save',
        format: request.format,
        showPrompt: true,
        showContent: true,
        showProvider: true,
        showTimestamp: true,
        width: 1_200,
        background: 'linear-gradient(140deg, #0f172a 0%, #1e293b 55%, #334155 100%)',
        cardTheme: 'dark',
      },
    });

    const outputDir = await getOutputDir();
    await fs.mkdir(outputDir, { recursive: true });
    const baseName = request.savedFileName.replace(/\.md$/i, '') || buildSafeFileNameFromTitle(request.title);
    const desiredPath = path.join(outputDir, `${baseName}.${captureResult.ext}`);
    const filePath = await getUniquePath(desiredPath, '');
    await fs.writeFile(filePath, captureResult.buffer);
    sendLog(`[telegram] ${request.format.toUpperCase()} export saved: ${path.basename(filePath)}`);
    return { ok: true, filePath };
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : 'export failed';
    const message = localizeUserFacingError(rawMessage, getLangCache());
    sendLog(`[telegram] export failed: ${rawMessage}`);
    return { ok: false, error: message };
  }
}
