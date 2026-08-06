import { PROVIDER_ALIASES } from '../providerCommands';
import type { ResolvedProviderCommand } from '../providerCommands';
import { LINE_PAIR_COMMAND } from './deepLink';

export const LINE_HELP_COMMAND = 'help';

const RESERVED_COMMANDS = new Set([LINE_PAIR_COMMAND.slice(1), LINE_HELP_COMMAND]);

const COMMAND_PATTERN = /^\/([a-z][a-z0-9_]{0,31})(?:\s+([\s\S]*))?$/i;

export interface LineCommand {
  name: string;
  argument: string;
}

export function parseLineCommand(text: string): LineCommand | null {
  const match = COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: (match[2] ?? '').trim() };
}

export function parsePairCommand(text: string): string | null {
  const command = parseLineCommand(text);
  if (!command || command.name !== LINE_PAIR_COMMAND.slice(1)) return null;
  return /^\S+$/.test(command.argument) ? command.argument : '';
}

export function isHelpCommand(command: LineCommand): boolean {
  return command.name === LINE_HELP_COMMAND;
}

export function resolveProviderTarget(
  command: LineCommand,
  providers: ResolvedProviderCommand[],
): ResolvedProviderCommand | null {
  if (RESERVED_COMMANDS.has(command.name)) return null;
  return providers.find((spec) => spec.command === command.name) ?? null;
}

export function resolveProviderAlias(
  command: LineCommand,
  providers: ResolvedProviderCommand[],
): ResolvedProviderCommand | null {
  if (RESERVED_COMMANDS.has(command.name)) return null;
  const provider = PROVIDER_ALIASES[command.name];
  if (!provider) return null;
  return providers.find((spec) => spec.provider === provider) ?? null;
}

export function listProviderCommands(providers: ResolvedProviderCommand[]): string {
  return providers.map((spec) => `/${spec.command}`).join('  ');
}
