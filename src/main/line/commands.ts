import { PROVIDER_ALIASES } from '../providerCommands';
import type { ResolvedProviderCommand } from '../providerCommands';
import { LINE_PAIR_COMMAND } from './deepLink';

export const LINE_HELP_COMMAND = 'help';

// Commands the bot answers itself; they must never resolve to a provider.
const RESERVED_COMMANDS = new Set([LINE_PAIR_COMMAND.slice(1), LINE_HELP_COMMAND]);

// '/gemini hi' → { name: 'gemini', argument: 'hi' }. Anything that does not look
// like a command (a bare URL, a question, a path with spaces) parses to null and
// is treated as a prompt.
const COMMAND_PATTERN = /^\/([a-z][a-z0-9_]{0,31})(?:\s+([\s\S]*))?$/i;

export interface LineCommand {
  name: string;
  argument: string;
}

// Exported for the test suite: pure, offline, deterministic.
export function parseLineCommand(text: string): LineCommand | null {
  const match = COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: (match[2] ?? '').trim() };
}

export function parsePairCommand(text: string): string | null {
  const command = parseLineCommand(text);
  if (!command || command.name !== LINE_PAIR_COMMAND.slice(1)) return null;
  // A pairing code never contains whitespace; '/pair AB12 CD34' is not a code.
  return /^\S+$/.test(command.argument) ? command.argument : '';
}

export function isHelpCommand(command: LineCommand): boolean {
  return command.name === LINE_HELP_COMMAND;
}

// The command exactly as configured in the shared AI-command settings.
export function resolveProviderTarget(
  command: LineCommand,
  providers: ResolvedProviderCommand[],
): ResolvedProviderCommand | null {
  if (RESERVED_COMMANDS.has(command.name)) return null;
  return providers.find((spec) => spec.command === command.name) ?? null;
}

// Fallback spelling: '/chatgpt' still reaches Gemini's neighbour even after the
// command was renamed to '/g'. Resolved only after flow and BYOK commands have
// had their turn, so an alias can never shadow a command a user named himself.
export function resolveProviderAlias(
  command: LineCommand,
  providers: ResolvedProviderCommand[],
): ResolvedProviderCommand | null {
  if (RESERVED_COMMANDS.has(command.name)) return null;
  const provider = PROVIDER_ALIASES[command.name];
  if (!provider) return null;
  return providers.find((spec) => spec.provider === provider) ?? null;
}

// The '/gpt, /gemini, …' list shown in the help and unknown-command replies.
export function listProviderCommands(providers: ResolvedProviderCommand[]): string {
  return providers.map((spec) => `/${spec.command}`).join('  ');
}
