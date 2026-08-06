import type { LinePairingSnapshot, LineRuntimeSnapshot, LineSettingsSnapshot } from '../shared/types';
import { config, saveConfig } from './config';
import { maskToken } from './helpers';
import {
  buildLinePairingLink,
  createLinePairingBridge,
  findLinePairedDisplayName,
  LINE_WEBHOOK_PATH,
  normalizeLinePairingState,
} from './line';
import type { LinePairingUserProfile } from './line';

let _lineRuntimeSnapshot: LineRuntimeSnapshot = {
  status: 'idle',
  webhookPath: LINE_WEBHOOK_PATH,
  updatedAt: new Date().toISOString(),
};

const pairingBridge = createLinePairingBridge(
  () => config.line.pairing,
  (next) => {
    config.line.pairing = next;
    saveConfig({ line: config.line });
  },
);

export function getLineRuntimeSnapshot(): LineRuntimeSnapshot {
  return _lineRuntimeSnapshot;
}

export function setLineRuntimeSnapshot(snapshot: LineRuntimeSnapshot): void {
  _lineRuntimeSnapshot = snapshot;
}

export function isLinePairedUser(userId: string): boolean {
  const id = (userId ?? '').trim();
  if (!id) return false;
  return pairingBridge.isPairedUser(id);
}

export function consumeLinePairingCode(
  code: string,
  user: LinePairingUserProfile,
): { ok: boolean; reason?: string } {
  return pairingBridge.consumePairingCode(code, user);
}

export function getLinePairedDisplayName(userId: string): string | undefined {
  const id = (userId ?? '').trim();
  if (!id) return undefined;
  return findLinePairedDisplayName(config.line.pairing, id);
}

function buildLinePairingSnapshot(): LinePairingSnapshot {
  const basicId = _lineRuntimeSnapshot.account?.basicId ?? '';
  const { pendingCodes, pairedUsers } = normalizeLinePairingState(config.line.pairing);
  return {
    pendingCodes: pendingCodes.map((pending) => ({
      ...pending,
      deepLink: buildLinePairingLink(basicId, pending.code),
    })),
    pairedUsers,
  };
}

export function buildLineSettingsSnapshot(): LineSettingsSnapshot {
  return {
    enabled: config.line.enabled,
    hasChannelAccessToken: Boolean(config.line.channelAccessToken.trim()),
    channelAccessTokenPreview: maskToken(config.line.channelAccessToken),
    hasChannelSecret: Boolean(config.line.channelSecret.trim()),
    channelSecretPreview: maskToken(config.line.channelSecret),
    port: config.line.port,
    pairing: buildLinePairingSnapshot(),
    webhookPath: LINE_WEBHOOK_PATH,
    llmDirect: config.line.llmDirect,
    runtime: _lineRuntimeSnapshot,
  };
}
