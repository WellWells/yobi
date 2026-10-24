import type { LinePairedUser, LinePairingState } from '../../shared/types';
import { findPendingCode, issuePendingCode, prunePendingCodes, revokePendingCode } from '../pairingCodes';

/*
 * Pairing for platforms whose ids are strings (LINE, Discord, Slack): codes from the settings page,
 * consumed by `/pair <code>` in a private chat, and the paired accounts with their names. Telegram
 * keeps numeric ids and its own module.
 */

export type BotPairingState = LinePairingState;
export type BotPairedUser = LinePairedUser;

export type BotPairingUserProfile = {
  userId: string;
  displayName?: string;
};

export function normalizeBotPairingState(state: BotPairingState): BotPairingState {
  return {
    pendingCodes: prunePendingCodes(state.pendingCodes),
    pairedUsers: dedupePairedUsers(state.pairedUsers),
  };
}

export function hasBotPairedUser(state: BotPairingState, userId: string): boolean {
  return state.pairedUsers.some((item) => item.userId === userId);
}

export function findBotPairedDisplayName(state: BotPairingState, userId: string): string | undefined {
  return state.pairedUsers.find((item) => item.userId === userId)?.displayName;
}

export function issueBotPairingCode(
  state: BotPairingState,
): { nextState: BotPairingState; code: string; expiresAt: string } {
  const normalized = normalizeBotPairingState(state);
  const issued = issuePendingCode(normalized.pendingCodes);
  return {
    nextState: {
      ...normalized,
      pendingCodes: [...normalized.pendingCodes, issued],
    },
    code: issued.code,
    expiresAt: issued.expiresAt,
  };
}

export function revokeBotPairingCode(state: BotPairingState, code: string): BotPairingState {
  const normalized = normalizeBotPairingState(state);
  return {
    ...normalized,
    pendingCodes: revokePendingCode(normalized.pendingCodes, code),
  };
}

export function unpairBotUser(state: BotPairingState, userId: string): BotPairingState {
  const normalized = normalizeBotPairingState(state);
  return {
    ...normalized,
    pairedUsers: normalized.pairedUsers.filter((item) => item.userId !== userId),
  };
}

export function consumeBotPairingCode(
  state: BotPairingState,
  rawCode: string,
  user: BotPairingUserProfile,
): { ok: boolean; nextState: BotPairingState; reason?: string } {
  const normalized = normalizeBotPairingState(state);
  if (!rawCode.trim()) {
    return { ok: false, nextState: normalized, reason: 'empty_code' };
  }
  const pending = findPendingCode(normalized.pendingCodes, rawCode);
  if (!pending) {
    return { ok: false, nextState: normalized, reason: 'invalid_code' };
  }
  return {
    ok: true,
    nextState: {
      pendingCodes: revokePendingCode(normalized.pendingCodes, pending.code),
      pairedUsers: upsertPairedUser(normalized.pairedUsers, user),
    },
  };
}

export interface BotPairingBridge {
  isPairedUser: (userId: string) => boolean;
  consumePairingCode: (code: string, user: BotPairingUserProfile) => { ok: boolean; reason?: string };
  /**
   * The owner let this person in without a code: the same effects as a code pairing (default
   * grants for an id not paired before, one save). False when the id was already paired or is
   * empty — nothing changes then, so two taps at once are one pairing.
   */
  pairWithoutCode: (user: BotPairingUserProfile) => boolean;
}

/**
 * `grantDefaults` runs when a code pairs an id that was not paired yet, before the one save, so
 * the account's default grants are written with its pairing.
 */
export function createBotPairingBridge(
  getPairing: () => BotPairingState,
  savePairing: (next: BotPairingState) => void,
  grantDefaults?: (userId: string) => void,
): BotPairingBridge {
  return {
    isPairedUser: (userId) => {
      const current = getPairing();
      const pairing = normalizeBotPairingState(current);
      if (pairing.pendingCodes.length !== current.pendingCodes.length) {
        savePairing(pairing);
      }
      return hasBotPairedUser(pairing, userId);
    },
    consumePairingCode: (code, user) => {
      const current = getPairing();
      const result = consumeBotPairingCode(current, code, user);
      const pruned = result.nextState.pendingCodes.length !== current.pendingCodes.length;
      if (result.ok && !hasBotPairedUser(current, user.userId)) grantDefaults?.(user.userId);
      if (result.ok || pruned) savePairing(result.nextState);
      return { ok: result.ok, reason: result.reason };
    },
    pairWithoutCode: (user) => {
      const userId = (user.userId ?? '').trim();
      if (!userId) return false;
      const current = normalizeBotPairingState(getPairing());
      if (hasBotPairedUser(current, userId)) return false;
      grantDefaults?.(userId);
      savePairing({ ...current, pairedUsers: upsertPairedUser(current.pairedUsers, { ...user, userId }) });
      return true;
    },
  };
}

function dedupePairedUsers(input: BotPairedUser[]): BotPairedUser[] {
  const seen = new Set<string>();
  const out: BotPairedUser[] = [];
  for (const user of input) {
    const userId = (user.userId ?? '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push(user);
  }
  return out;
}

function upsertPairedUser(existing: BotPairedUser[], user: BotPairingUserProfile): BotPairedUser[] {
  const next = [...existing];
  const idx = next.findIndex((item) => item.userId === user.userId);
  const merged: BotPairedUser = {
    userId: user.userId,
    displayName: user.displayName || undefined,
    pairedAt: idx >= 0 ? next[idx].pairedAt : new Date().toISOString(),
  };
  if (idx >= 0) {
    next[idx] = merged;
  } else {
    next.push(merged);
  }
  return next;
}
