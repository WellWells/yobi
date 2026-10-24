import { PROVIDER_ALIASES } from '../providerCommands';
import type { ResolvedProviderCommand } from '../providerCommands';

/** `/pair <code>`: an unpaired person's private chat pairs with a code from the settings page. */
export const BOT_PAIR_COMMAND = 'pair';
export const BOT_HELP_COMMAND = 'help';

const COMMAND_PATTERN = /^\/([a-z][a-z0-9_]{0,31})(?:\s+([\s\S]*))?$/i;

export interface BotCommand {
  name: string;
  argument: string;
}

/** A typed `/command argument` line, the name lowercased; null for anything else. */
export function parseBotCommand(text: string): BotCommand | null {
  const match = COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), argument: (match[2] ?? '').trim() };
}

/** The code of a `/pair <code>` line ('' when it has none or several words); null for any other line. */
export function parsePairCommand(text: string): string | null {
  const command = parseBotCommand(text);
  if (!command || command.name !== BOT_PAIR_COMMAND) return null;
  return /^\S+$/.test(command.argument) ? command.argument : '';
}

export function isHelpCommand(command: BotCommand): boolean {
  return command.name === BOT_HELP_COMMAND;
}

/** Pairing and help are never a model's command, nor is any name the platform keeps for itself. */
function isReserved(name: string, reserved: ReadonlySet<string>): boolean {
  return name === BOT_PAIR_COMMAND || name === BOT_HELP_COMMAND || reserved.has(name);
}

export function resolveProviderTarget(
  command: BotCommand,
  providers: ResolvedProviderCommand[],
  reserved: ReadonlySet<string> = new Set(),
): ResolvedProviderCommand | null {
  if (isReserved(command.name, reserved)) return null;
  return providers.find((spec) => spec.command === command.name) ?? null;
}

export function resolveProviderAlias(
  command: BotCommand,
  providers: ResolvedProviderCommand[],
  reserved: ReadonlySet<string> = new Set(),
): ResolvedProviderCommand | null {
  if (isReserved(command.name, reserved)) return null;
  const provider = PROVIDER_ALIASES[command.name];
  if (!provider) return null;
  return providers.find((spec) => spec.provider === provider) ?? null;
}

export function listProviderCommands(providers: ResolvedProviderCommand[]): string {
  return providers.map((spec) => `/${spec.command}`).join('  ');
}
