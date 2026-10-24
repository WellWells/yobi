import type { TelegramPairedUser, TelegramPairingState } from '../../shared/types';
import { findPendingCode, issuePendingCode, prunePendingCodes, revokePendingCode } from '../pairingCodes';

export type PairingUserProfile = {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export function normalizePairingState(state: TelegramPairingState): TelegramPairingState {
  return {
    pendingCodes: prunePendingCodes(state.pendingCodes),
    pairedUsers: dedupePairedUsers(state.pairedUsers),
  };
}

export function hasPairedUser(state: TelegramPairingState, userId: number): boolean {
  return state.pairedUsers.some((item) => item.userId === userId);
}

export function issuePairingCode(
  state: TelegramPairingState,
): { nextState: TelegramPairingState; code: string; expiresAt: string } {
  const normalized = normalizePairingState(state);
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

export function revokePairingCode(state: TelegramPairingState, code: string): TelegramPairingState {
  const normalized = normalizePairingState(state);
  return {
    ...normalized,
    pendingCodes: revokePendingCode(normalized.pendingCodes, code),
  };
}

export function unpairUser(state: TelegramPairingState, userId: number): TelegramPairingState {
  const normalized = normalizePairingState(state);
  return {
    ...normalized,
    pairedUsers: normalized.pairedUsers.filter((item) => item.userId !== userId),
  };
}

export function consumePairingCode(
  state: TelegramPairingState,
  rawCode: string,
  user: PairingUserProfile,
): { ok: boolean; nextState: TelegramPairingState; reason?: string } {
  const normalized = normalizePairingState(state);
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

export interface PairingBridge {
  isPairedUser: (userId: number) => boolean;
  consumePairingCode: (
    code: string,
    user: PairingUserProfile,
  ) => { ok: boolean; reason?: string };
  /**
   * A manager let this person in without a code: the same effects as a code pairing. False when
   * the id was already paired — nothing changes then, so two managers pressing at once is one pairing.
   */
  pairWithoutCode: (user: PairingUserProfile) => boolean;
}

/**
 * `grantDefaults` runs when a code pairs an id that was not paired yet, before the one save, so
 * the account's default grants are written with its pairing.
 */
export function createPairingBridge(
  getPairing: () => TelegramPairingState,
  savePairing: (next: TelegramPairingState) => void,
  onPaired?: (user: PairingUserProfile) => void,
  grantDefaults?: (userId: number) => void,
): PairingBridge {
  return {
    isPairedUser: (userId) => {
      const pairing = normalizePairingState(getPairing());
      if (pairing.pendingCodes.length !== getPairing().pendingCodes.length) {
        savePairing(pairing);
      }
      return hasPairedUser(pairing, userId);
    },
    consumePairingCode: (code, user) => {
      const current = getPairing();
      const result = consumePairingCode(current, code, user);
      // A wrong code changes nothing unless pruning dropped an expired one, so a stranger's guess
      // neither rewrites config.json nor re-pushes the runtime snapshot.
      const pruned = result.nextState.pendingCodes.length !== current.pendingCodes.length;
      if (result.ok && !hasPairedUser(current, user.userId)) grantDefaults?.(user.userId);
      if (result.ok || pruned) savePairing(result.nextState);
      if (result.ok) onPaired?.(user);
      return { ok: result.ok, reason: result.reason };
    },
    pairWithoutCode: (user) => {
      if (!Number.isSafeInteger(user.userId) || user.userId <= 0) return false;
      const current = normalizePairingState(getPairing());
      if (hasPairedUser(current, user.userId)) return false;
      grantDefaults?.(user.userId);
      savePairing({ ...current, pairedUsers: upsertPairedUser(current.pairedUsers, user) });
      onPaired?.(user);
      return true;
    },
  };
}

function dedupePairedUsers(input: TelegramPairedUser[]): TelegramPairedUser[] {
  const seen = new Set<number>();
  const out: TelegramPairedUser[] = [];
  for (const user of input) {
    if (!Number.isFinite(user.userId) || user.userId <= 0 || seen.has(user.userId)) continue;
    seen.add(user.userId);
    out.push(user);
  }
  return out;
}

function upsertPairedUser(existing: TelegramPairedUser[], user: PairingUserProfile): TelegramPairedUser[] {
  const next = [...existing];
  const idx = next.findIndex((item) => item.userId === user.userId);
  const merged: TelegramPairedUser = {
    userId: user.userId,
    username: user.username || undefined,
    firstName: user.firstName || undefined,
    lastName: user.lastName || undefined,
    pairedAt: idx >= 0 ? next[idx].pairedAt : new Date().toISOString(),
  };
  if (idx >= 0) {
    next[idx] = merged;
  } else {
    next.push(merged);
  }
  return next;
}
