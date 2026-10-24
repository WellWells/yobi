/**
 * What the settings page, the IPC handlers, the flow engine and the running bots share about the
 * socket platforms (Discord, Slack): the last runtime snapshot, the pairing, and the account
 * changes the settings page makes. One module for both platforms; everything takes the platform.
 */
import { IPC, SOCKET_BOT_PLATFORMS, SOCKET_BOT_SECRET_FIELDS } from '../shared/types';
import type { PendingPairingCode, SocketBotPlatform, SocketBotRuntimeSnapshot, SocketBotSettingsSnapshot } from '../shared/types';
import { config, saveConfig } from './config';
import { dropBotPermissions, grantPairingDefaults } from './botPermissions';
import { maskToken, sendLog, sendToRenderer } from './helpers';
import {
  createBotPairingBridge,
  issueBotPairingCode,
  normalizeBotPairingState,
  revokeBotPairingCode,
  unpairBotUser,
  type BotPairingBridge,
  type BotPairingUserProfile,
} from './botChat/pairingState';

function idleSnapshot(platform: SocketBotPlatform): SocketBotRuntimeSnapshot {
  return { platform, status: 'idle', updatedAt: new Date().toISOString() };
}

const snapshots = new Map<SocketBotPlatform, SocketBotRuntimeSnapshot>(
  SOCKET_BOT_PLATFORMS.map((platform) => [platform, idleSnapshot(platform)]),
);

const bridges = new Map<SocketBotPlatform, BotPairingBridge>(SOCKET_BOT_PLATFORMS.map((platform) => [
  platform,
  createBotPairingBridge(
    () => config[platform].pairing,
    (next) => {
      config[platform].pairing = next;
      saveConfig({ [platform]: config[platform] });
    },
    (userId) => grantPairingDefaults(platform, userId),
  ),
]));

function bridgeOf(platform: SocketBotPlatform): BotPairingBridge {
  const bridge = bridges.get(platform);
  if (!bridge) throw new Error(`no pairing for ${platform}`);
  return bridge;
}

export function setSocketBotRuntimeSnapshot(snapshot: SocketBotRuntimeSnapshot): void {
  snapshots.set(snapshot.platform, snapshot);
}

export function getSocketBotRuntimeSnapshot(platform: SocketBotPlatform): SocketBotRuntimeSnapshot {
  return snapshots.get(platform) ?? idleSnapshot(platform);
}

/** The settings page refetches its snapshot of this platform on this broadcast. */
export function announceSocketBotRuntime(platform: SocketBotPlatform): void {
  sendToRenderer(IPC.SOCKET_BOT_RUNTIME, getSocketBotRuntimeSnapshot(platform));
}

export function isSocketBotPairedUser(platform: SocketBotPlatform, userId: string): boolean {
  const id = (userId ?? '').trim();
  return Boolean(id) && bridgeOf(platform).isPairedUser(id);
}

export function consumeSocketBotPairingCode(platform: SocketBotPlatform, code: string, user: BotPairingUserProfile): { ok: boolean; reason?: string } {
  return bridgeOf(platform).consumePairingCode(code, user);
}

/** Pairs without a code, as `/pair <code>` would; false = already paired, nothing changed. */
export function pairSocketBotUserWithoutCode(platform: SocketBotPlatform, user: BotPairingUserProfile): boolean {
  return bridgeOf(platform).pairWithoutCode(user);
}

/** Unpairs one account with its grants. */
export function unpairSocketBotAccount(platform: SocketBotPlatform, userId: string): boolean {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  config[platform].pairing = unpairBotUser(config[platform].pairing, id);
  dropBotPermissions(platform, id);
  saveConfig({ [platform]: config[platform] });
  announceSocketBotRuntime(platform);
  return true;
}

export function issueSocketBotPairingCode(platform: SocketBotPlatform): { code: string; expiresAt: string } {
  const issued = issueBotPairingCode(config[platform].pairing);
  config[platform].pairing = issued.nextState;
  saveConfig({ [platform]: config[platform] });
  sendLog(`${platform} pairing code generated (expires at ${issued.expiresAt})`);
  announceSocketBotRuntime(platform);
  return { code: issued.code, expiresAt: issued.expiresAt };
}

export function revokeSocketBotPairingCode(platform: SocketBotPlatform, code: string): void {
  config[platform].pairing = revokeBotPairingCode(config[platform].pairing, String(code ?? ''));
  saveConfig({ [platform]: config[platform] });
  announceSocketBotRuntime(platform);
}

/** The codes still valid, expired ones pruned (and the prune saved) first. */
export function validSocketBotPairingCodes(platform: SocketBotPlatform): PendingPairingCode[] {
  const current = config[platform].pairing;
  const pruned = normalizeBotPairingState(current);
  if (pruned.pendingCodes.length !== current.pendingCodes.length) {
    config[platform].pairing = pruned;
    saveConfig({ [platform]: config[platform] });
  }
  return pruned.pendingCodes;
}

/** A secret field's value, by name (`SOCKET_BOT_SECRET_FIELDS`). */
export function socketBotSecret(platform: SocketBotPlatform, field: string): string {
  const value = (config[platform] as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

export function buildSocketBotSettingsSnapshot(platform: SocketBotPlatform): SocketBotSettingsSnapshot {
  const section = config[platform];
  const pairing = normalizeBotPairingState(section.pairing);
  return {
    platform,
    enabled: section.enabled,
    secrets: Object.fromEntries(SOCKET_BOT_SECRET_FIELDS[platform].map((field) => {
      const value = socketBotSecret(platform, field);
      return [field, { has: Boolean(value.trim()), preview: maskToken(value) }];
    })),
    pairing: { pendingCodes: pairing.pendingCodes, pairedUsers: pairing.pairedUsers },
    permissions: section.permissions,
    defaultGrants: section.defaultGrants,
    llmDirect: section.llmDirect,
    runtime: getSocketBotRuntimeSnapshot(platform),
  };
}
