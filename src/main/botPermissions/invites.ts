/**
 * The platform-neutral half of `/invite`: a pairing code from the settings page's store, shown
 * with when it stops working and a "Revoke" button, the other codes still valid listed under it,
 * and who issued each code from the chat — so the one who sent the link hears when it is used.
 */
import { normalizePairingCodeInput } from '../pairingCodes';

export interface PendingInvite {
  code: string;
  expiresAt: string;
}

/** What a platform's `/invite` reads and writes; absent = the command does nothing. */
export interface InviteStore {
  /** A new code in the settings page's store; null = it could not be made. */
  issue: () => PendingInvite | null;
  /** The codes still valid, expired ones pruned first. */
  list: () => PendingInvite[];
  revoke: (code: string) => boolean;
}

export const MAX_LISTED_INVITES = 20;

const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

/** A "Revoke" button's payload after the platform's prefix. */
export function inviteRevokePayload(code: string): string {
  return `r:${code}`;
}

export function parseInviteRevokePayload(payload: string): { code: string } | null {
  const [op, code, ...rest] = payload.split(':');
  if (op !== 'r' || rest.length > 0 || !code || !CODE_PATTERN.test(code)) return null;
  return { code };
}

/** "HH:MM" on this computer's clock. */
export function localClock(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '';
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The valid codes other than the one just made, as many as a card lists. */
export function otherInvites(fresh: PendingInvite | null, codes: readonly PendingInvite[]): PendingInvite[] {
  return codes.filter((entry) => entry.code !== fresh?.code).slice(0, MAX_LISTED_INVITES);
}

/**
 * Revokes a code a "Revoke" button names, if it is still one of the valid codes; a code already
 * used, revoked or expired changes nothing. Returns whether it was there.
 */
export function revokeListedInvite(store: InviteStore, rawCode: string): boolean {
  const code = normalizePairingCodeInput(rawCode);
  const known = store.list().some((entry) => entry.code === code);
  if (known) store.revoke(code);
  return known;
}

const MAX_REMEMBERED = 100;

/**
 * Which manager issued a pairing code from the chat. In memory only: a restart forgets it, and the
 * pairing itself is unaffected.
 */
export class InviteIssuers<Id = number> {
  private readonly issuers = new Map<string, Id>();

  remember(code: string, managerId: Id): void {
    const key = normalizePairingCodeInput(code);
    if (!key) return;
    this.issuers.delete(key);
    this.issuers.set(key, managerId);
    // Oldest first out: a code is good for an hour, so only a flood of /invite reaches the cap.
    while (this.issuers.size > MAX_REMEMBERED) {
      const oldest = this.issuers.keys().next().value;
      if (oldest === undefined) break;
      this.issuers.delete(oldest);
    }
  }

  /** The issuer of a code that was just used, forgotten as it is read. */
  take(code: string): Id | undefined {
    const key = normalizePairingCodeInput(code);
    const issuer = this.issuers.get(key);
    this.issuers.delete(key);
    return issuer;
  }
}
