import type { TelegramPairedUser, TelegramPairingState } from '../../shared/types';

export const PAIRING_CODE_TTL_MS = 60 * 60 * 1000;

export type PairingUserProfile = {
  userId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export function normalizePairingState(state: TelegramPairingState): TelegramPairingState {
  return {
    pendingCodes: state.pendingCodes.filter((item) => Date.parse(item.expiresAt) > Date.now()),
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
  const now = Date.now();
  const expiresAt = new Date(now + PAIRING_CODE_TTL_MS).toISOString();
  const existing = new Set(normalized.pendingCodes.map((item) => item.code));
  const code = createPairingCode(existing);
  return {
    nextState: {
      ...normalized,
      pendingCodes: [
        ...normalized.pendingCodes,
        {
          code,
          sessionId,
          createdAt: new Date(now).toISOString(),
          expiresAt,
        },
      ],
    },
    code,
    expiresAt,
  };
}

export function revokePairingCode(state: TelegramPairingState, code: string): TelegramPairingState {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return normalizePairingState(state);
  const normalized = normalizePairingState(state);
  return {
    ...normalized,
    pendingCodes: normalized.pendingCodes.filter((item) => item.code !== normalizedCode),
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
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { ok: false, nextState: normalized, reason: 'empty_code' };
  }
  const pending = normalized.pendingCodes.find((item) => item.code === code);
  if (!pending) {
    return { ok: false, nextState: normalized, reason: 'invalid_code' };
  }
  const pairedUsers = upsertPairedUser(normalized.pairedUsers, user);
  return {
    ok: true,
    nextState: {
      pendingCodes: normalized.pendingCodes.filter((item) => item.code !== code),
      pairedUsers,
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
      return { ok: result.ok, reason: result.reason };
    },
  };
}

function createPairingCode(existing: Set<string>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!existing.has(code)) return code;
  }
  return `${Date.now().toString(36).slice(-8).toUpperCase()}`;
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
