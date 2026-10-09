import type {
  CaptureSettings,
  MarkdownCaptureRequest,
  QueueState,
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
} from '../shared/types';
import { captureBackgroundCss, paletteCardTheme } from '../shared/capturePalettes';
import type { CaptureBackgroundStyle, CaptureDirection } from '../shared/capturePalettes';
import { formatCardTime, mustShowPrompt } from '../shared/captureCard';
import { normalizePairingState } from './telegram';
import { listBotContacts } from './botDirectory';
import { isTelegramAdminGrant, telegramAdminMirror } from './botPermissions';
import { config, saveConfig } from './config';
import { maskToken, sendLog } from './helpers';
import { getLangCache, localizeUserFacingError, t } from './i18n';
import { captureMarkdownDocument, buildCaptureSummary } from './capture';
import { buildSafeFileNameFromTitle, getOutputDir, getUniquePath } from './files';
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

/** Admin is the `admin` grant on a still-paired account; `adminUserIds` is only its mirror. */
export function isTelegramAdminUser(userId: number): boolean {
  return isTelegramAdminGrant(userId);
}

export async function buildTelegramSettingsSnapshot(): Promise<TelegramSettingsSnapshot> {
  const normalizedPairing = normalizePairingState(config.telegram.pairing);
  const normalizedAdmins = telegramAdminMirror(
    config.telegram.permissions,
    normalizedPairing.pairedUsers.map((user) => user.userId),
  );

  if (normalizedPairing.pendingCodes.length !== config.telegram.pairing.pendingCodes.length) {
    config.telegram.pairing = normalizedPairing;
    saveConfig({ telegram: config.telegram });
  }
  // Keeps the mirror in step with the grants; never the other way round.
  const mirror = config.telegram.adminUserIds;
  if (normalizedAdmins.length !== mirror.length || normalizedAdmins.some((id) => !mirror.includes(id))) {
    config.telegram.adminUserIds = normalizedAdmins;
    saveConfig({ telegram: config.telegram });
  }

  return {
    enabled: config.telegram.enabled,
    hasToken: Boolean(config.telegram.botToken.trim()),
    tokenPreview: maskToken(config.telegram.botToken),
    allowGroupCommands: config.telegram.allowGroupCommands,
    defaultReplyMode: config.telegram.defaultReplyMode,
    compactReply: config.telegram.compactReply,
    adminUserIds: normalizedAdmins,
    permissions: config.telegram.permissions,
    llmDirect: config.telegram.llmDirect,
    runtime: _telegramRuntimeSnapshot,
    pairing: normalizedPairing,
    channels: config.telegram.channels,
    knownUsers: config.telegram.knownUsers,
    contacts: await listBotContacts({ platform: 'telegram' }),
  };
}

/**
 * The admin /status reply, built from the same merged queue as the title bar (`appQueueState`),
 * so a running flow or /agent run is reported as running. No "Telegram: running" line — the bot
 * answering is already the proof — and no overall queue line repeating the two below it.
 * The prompt queue and the flow queue run side by side, so each running item gets its own line.
 */
export function buildTelegramStatusText(state: QueueState): string {
  const s = getLangCache();
  const running = state.items.filter((item) => item.status === 'running');
  const queuedCount = state.items.filter((item) => item.status === 'queued').length;
  const runningLines = running.length > 0
    ? running.map((item) => t(s, 'telegram.status.running', { task: `${item.id} — ${item.promptSummary}` }))
    : [t(s, 'telegram.status.running', { task: t(s, 'telegram.status.runningNone') })];

  return [
    t(s, 'telegram.status.header'),
    ...runningLines,
    t(s, 'telegram.status.queued', { count: `${queuedCount}` }),
  ].join('\n');
}

export interface TelegramExportRequest {
  format: 'png' | 'webp' | 'pdf';
  providerLabel: string;
  savedFileName: string;
  prompt: string;
  response: string;
  title: string;
}

/**
 * The card a bot export renders, in the user's Card style (the same one the shortcut, the export
 * dialog and a flow's capture step use). The answer goes in as one turn, with no
 * "Prompt"/"Content" section labels.
 */
export function buildTelegramCaptureRequest(
  request: TelegramExportRequest,
  settings: CaptureSettings,
  exportedAt: string,
  locale: string,
): MarkdownCaptureRequest {
  const timestamp = formatCardTime(exportedAt, locale);
  return {
    payload: {
      title: request.title || request.savedFileName.replace(/\.md$/i, ''),
      prompt: request.prompt,
      content: request.response,
      summary: buildCaptureSummary(request.response),
      provider: request.providerLabel,
      timestamp,
      turns: [{ prompt: request.prompt, response: request.response, provider: request.providerLabel, timestamp }],
    },
    options: {
      mode: 'save',
      format: request.format,
      fileName: request.savedFileName.replace(/\.md$/i, '') || buildSafeFileNameFromTitle(request.title),
      showPrompt: mustShowPrompt(settings.cardLayout, 1) || settings.showPrompt,
      showContent: true,
      showProvider: settings.showProvider,
      showTimestamp: settings.showTimestamp,
      showTokens: false,
      width: settings.width,
      margin: settings.margin,
      background: captureBackgroundCss(
        settings.palette,
        settings.backgroundStyle as CaptureBackgroundStyle,
        settings.direction as CaptureDirection,
      ),
      cardTheme: paletteCardTheme(settings.palette),
      cardLayout: settings.cardLayout,
      pixelRatio: settings.pixelRatio,
      zip: false,
    },
  };
}

export async function exportTelegramResultDocument(
  request: TelegramExportRequest,
): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  try {
    const captureRequest = buildTelegramCaptureRequest(
      request,
      config.captureSettings,
      new Date().toISOString(),
      config.locale,
    );
    const baseName = captureRequest.options.fileName ?? '';
    const captureResult = await captureMarkdownDocument(captureRequest);

    const outputDir = await getOutputDir();
    await fs.mkdir(outputDir, { recursive: true });
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
