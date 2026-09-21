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
  sessionId: string,
): { nextState: TelegramPairingState; code: string; expiresAt: string } {
  const normalized = normalizePairingState(state);
  const issued = issuePendingCode(normalized.pendingCodes);
  return {
    nextState: {
      ...normalized,
      pendingCodes: [...normalized.pendingCodes, { ...issued, sessionId }],
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
}

export function createPairingBridge(
  getPairing: () => TelegramPairingState,
  savePairing: (next: TelegramPairingState) => void,
  onPaired?: (user: PairingUserProfile) => void,
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
      const pairing = normalizePairingState(getPairing());
      const result = consumePairingCode(pairing, code, user);
      savePairing(result.nextState);
      if (result.ok) onPaired?.(user);
      return { ok: result.ok, reason: result.reason };
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
