import { randomInt } from 'node:crypto';

// Shared lifecycle for the short-lived pairing codes used by both the Telegram
// and LINE bots. Only the code envelope lives here — each platform keeps its own
// paired-user record because the profile fields differ.
export interface PendingPairingCode {
  code: string;
  createdAt: string;
  expiresAt: string;
}

export const PAIRING_CODE_TTL_MS = 60 * 60 * 1_000;

// Excludes I/O/0/1 so a code read off the screen is never mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function normalizePairingCodeInput(raw: string): string {
  return raw.trim().toUpperCase();
}

// A pairing code grants bot access, so it is drawn from a CSPRNG rather than
// Math.random().
export function createPairingCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('Failed to generate a unique pairing code');
}

export function issuePendingCode(existing: PendingPairingCode[]): PendingPairingCode {
  const now = Date.now();
  return {
    code: createPairingCode(new Set(existing.map((item) => item.code))),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAIRING_CODE_TTL_MS).toISOString(),
  };
}

export function prunePendingCodes<T extends PendingPairingCode>(codes: T[]): T[] {
  const now = Date.now();
  return codes.filter((item) => Date.parse(item.expiresAt) > now);
}

export function revokePendingCode<T extends PendingPairingCode>(codes: T[], raw: string): T[] {
  const code = normalizePairingCodeInput(raw);
  if (!code) return codes;
  return codes.filter((item) => item.code !== code);
}

export function findPendingCode<T extends PendingPairingCode>(codes: T[], raw: string): T | undefined {
  const code = normalizePairingCodeInput(raw);
  if (!code) return undefined;
  return codes.find((item) => item.code === code);
}
