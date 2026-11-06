import type {
  QueueState,
  TelegramRuntimeSnapshot,
  TelegramSettingsSnapshot,
} from '../shared/types';
import { normalizePairingState } from './telegram';
import { listBotContacts } from './botDirectory';
import { isTelegramAdminGrant, telegramAdminMirror } from './botPermissions';
import { config, saveConfig } from './config';
import { maskToken } from './helpers';
import { getLangCache, t } from './i18n';

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
    largeUpload: {
      apiId: config.telegram.apiId,
      hasApiHash: Boolean(config.telegram.apiHash),
      apiHashPreview: maskToken(config.telegram.apiHash),
    },
    allowGroupCommands: config.telegram.allowGroupCommands,
    permissions: config.telegram.permissions,
    defaultGrants: config.telegram.defaultGrants,
    llmDirect: config.telegram.llmDirect,
    runtime: _telegramRuntimeSnapshot,
    pairing: normalizedPairing,
    channels: config.telegram.channels,
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
