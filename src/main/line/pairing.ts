import type { LinePairedUser, LinePairingState } from '../../shared/types';
import { findPendingCode, issuePendingCode, prunePendingCodes, revokePendingCode } from '../pairingCodes';

export type LinePairingUserProfile = {
  userId: string;
  displayName?: string;
};

export function normalizeLinePairingState(state: LinePairingState): LinePairingState {
  return {
    pendingCodes: prunePendingCodes(state.pendingCodes),
    pairedUsers: dedupePairedUsers(state.pairedUsers),
  };
}

export function hasLinePairedUser(state: LinePairingState, userId: string): boolean {
  return state.pairedUsers.some((item) => item.userId === userId);
}

export function findLinePairedDisplayName(state: LinePairingState, userId: string): string | undefined {
  return state.pairedUsers.find((item) => item.userId === userId)?.displayName;
}

export function issueLinePairingCode(
  state: LinePairingState,
): { nextState: LinePairingState; code: string; expiresAt: string } {
  const normalized = normalizeLinePairingState(state);
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

export function revokeLinePairingCode(state: LinePairingState, code: string): LinePairingState {
  const normalized = normalizeLinePairingState(state);
  return {
    ...normalized,
    pendingCodes: revokePendingCode(normalized.pendingCodes, code),
  };
}

export function unpairLineUser(state: LinePairingState, userId: string): LinePairingState {
  const normalized = normalizeLinePairingState(state);
  return {
    ...normalized,
    pairedUsers: normalized.pairedUsers.filter((item) => item.userId !== userId),
  };
}

export function consumeLinePairingCode(
  state: LinePairingState,
  rawCode: string,
  user: LinePairingUserProfile,
): { ok: boolean; nextState: LinePairingState; reason?: string } {
  const normalized = normalizeLinePairingState(state);
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

export interface LinePairingBridge {
  isPairedUser: (userId: string) => boolean;
  consumePairingCode: (code: string, user: LinePairingUserProfile) => { ok: boolean; reason?: string };
}

export function createLinePairingBridge(
  getPairing: () => LinePairingState,
  savePairing: (next: LinePairingState) => void,
): LinePairingBridge {
  return {
    isPairedUser: (userId) => {
      const current = getPairing();
      const pairing = normalizeLinePairingState(current);
      if (pairing.pendingCodes.length !== current.pendingCodes.length) {
        savePairing(pairing);
      }
      return hasLinePairedUser(pairing, userId);
    },
    consumePairingCode: (code, user) => {
      const current = getPairing();
      const result = consumeLinePairingCode(current, code, user);
      const pruned = result.nextState.pendingCodes.length !== current.pendingCodes.length;
      if (result.ok || pruned) savePairing(result.nextState);
      return { ok: result.ok, reason: result.reason };
    },
  };
}

function dedupePairedUsers(input: LinePairedUser[]): LinePairedUser[] {
  const seen = new Set<string>();
  const out: LinePairedUser[] = [];
  for (const user of input) {
    const userId = (user.userId ?? '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push(user);
  }
  return out;
}

function upsertPairedUser(existing: LinePairedUser[], user: LinePairingUserProfile): LinePairedUser[] {
  const next = [...existing];
  const idx = next.findIndex((item) => item.userId === user.userId);
  const merged: LinePairedUser = {
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
