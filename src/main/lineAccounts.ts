/**
 * The LINE account changes the settings page and the bot's own `/users` and `/invite` both make,
 * written once so the two can never differ: unpairing (pairing and grants) and issuing or revoking
 * a pairing code. Each one tells the settings page, which refetches on the runtime broadcast.
 */
import { IPC } from '../shared/types';
import type { PendingPairingCode } from '../shared/types';
import { config, saveConfig } from './config';
import { sendLog, sendToRenderer } from './helpers';
import { issueLinePairingCode, normalizeLinePairingState, revokeLinePairingCode, unpairLineUser } from './line';
import { dropBotPermissions } from './botPermissions';
import { getLineRuntimeSnapshot } from './lineBridge';

function announce(): void {
  sendToRenderer(IPC.LINE_RUNTIME, getLineRuntimeSnapshot());
}

/** Unpairs one account with its grants. */
export function unpairLineAccount(userId: string): boolean {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  config.line.pairing = unpairLineUser(config.line.pairing, id);
  dropBotPermissions('line', id);
  saveConfig({ line: config.line });
  announce();
  return true;
}

/** A new pairing code in the one store the settings page lists. */
export function issueLineAccountCode(): { code: string; expiresAt: string } {
  const issued = issueLinePairingCode(config.line.pairing);
  config.line.pairing = issued.nextState;
  saveConfig({ line: config.line });
  sendLog(`LINE pairing code generated (expires at ${issued.expiresAt})`);
  announce();
  return { code: issued.code, expiresAt: issued.expiresAt };
}

export function revokeLineAccountCode(code: string): void {
  config.line.pairing = revokeLinePairingCode(config.line.pairing, String(code ?? ''));
  saveConfig({ line: config.line });
  announce();
}

/** The codes still valid, expired ones pruned (and the prune saved) first. */
export function validLinePairingCodes(): PendingPairingCode[] {
  const pruned = normalizeLinePairingState(config.line.pairing);
  if (pruned.pendingCodes.length !== config.line.pairing.pendingCodes.length) {
    config.line.pairing = pruned;
    saveConfig({ line: config.line });
  }
  return pruned.pendingCodes;
}
