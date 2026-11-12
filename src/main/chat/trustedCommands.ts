import { config, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import { IPC } from '../../shared/types';
import {
  TRUSTED_COMMANDS_MAX, mergedOptions, normalizeTrustedCommands, sameTrustedCommand, trustedCommandCovers, trustedCommandLabel,
} from '../../shared/trustedCommands';
import type { TrustedCommand } from '../../shared/trustedCommands';
import type { TrustKey } from '../flow/agent/shellTrust';

/*
 * The desktop user's "always allow" list for `/agent` shell commands. Only the confirmation adds to
 * it (`addTrustedShellCommands`, after the user picked that button for a command the check could
 * vouch for); Settings lists and removes. There is no IPC that adds: the renderer shows pages and
 * model output, and nothing it is talked into may grant running a program.
 */

export function trustedShellCommands(): readonly TrustedCommand[] {
  return config.agentTrustedCommands;
}

function store(next: TrustedCommand[]): TrustedCommand[] {
  saveConfig({ agentTrustedCommands: next });
  const saved = config.agentTrustedCommands;
  sendToRenderer(IPC.AGENT_TRUSTED_COMMANDS_CHANGED, saved);
  return saved;
}

/**
 * Adds what the user just allowed: a new program and action, or the options this command used to
 * the grant that already has them. At the cap the oldest grants make room.
 */
export function addTrustedShellCommands(keys: readonly TrustKey[], now: Date = new Date()): readonly TrustedCommand[] {
  const platform = process.platform;
  const fresh = keys.filter((key) => !config.agentTrustedCommands.some((entry) => trustedCommandCovers(entry, key, platform)));
  if (fresh.length === 0) return config.agentTrustedCommands;
  const next = config.agentTrustedCommands.map((entry) => {
    const widened = fresh.filter((key) => sameTrustedCommand(entry, key, platform));
    return widened.length === 0 ? entry : { ...entry, options: widened.reduce((all, key) => mergedOptions(all, key.options), entry.options) };
  });
  for (const key of fresh) {
    if (next.some((entry) => sameTrustedCommand(entry, key, platform))) continue;
    next.push({ program: key.program, verb: key.verb, options: [...key.options], addedAt: now.toISOString() });
  }
  sendLog(`🔓 [Agent] always allow: ${fresh.map(trustedCommandLabel).join(', ')}`);
  return store(normalizeTrustedCommands(next.slice(-TRUSTED_COMMANDS_MAX), platform));
}

export function removeTrustedShellCommand(raw: unknown): readonly TrustedCommand[] {
  const { program, verb } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof program !== 'string' || typeof verb !== 'string') return config.agentTrustedCommands;
  const key = { program, verb };
  const next = config.agentTrustedCommands.filter((entry) => !sameTrustedCommand(entry, key, process.platform));
  if (next.length === config.agentTrustedCommands.length) return config.agentTrustedCommands;
  sendLog(`🔒 [Agent] no longer always allowed: ${trustedCommandLabel({ ...key, options: [] })}`);
  return store(next);
}
