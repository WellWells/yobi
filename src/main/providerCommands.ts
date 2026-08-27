import {
  BOT_BUILTIN_COMMAND_KEYS,
  BOT_COMMAND_RE,
  BUILTIN_NEW_COMMAND,
  DEFAULT_BUILTIN_COMMANDS,
  DEFAULT_PROVIDER_COMMANDS,
  PROVIDERS,
  PROVIDER_URLS,
  buildDuckaiModelUrl,
  isModelUrlHidden,
} from '../shared/types';
import type {
  BotBuiltinCommandKey,
  BotBuiltinCommands,
  BotByokCommands,
  BotLlmDirectConfig,
  BotProviderCommand,
  HiddenSources,
  Provider,
} from '../shared/types';
import { resolveByokCommands } from './byokCommands';
import type { ByokCommandDef } from './byokCommands';

export interface ResolvedProviderCommand {
  provider: Provider | 'byok';
  command: string;
  targetUrl: string;
  descriptionKey?: string;
  description?: string;
}

const PROVIDER_DESCRIPTION_KEYS: Record<Provider, string> = {
  chatgpt: 'telegram.commands.gpt',
  gemini: 'telegram.commands.gemini',
  perplexity: 'telegram.commands.pplx',
  duckai: 'telegram.commands.duck',
};

const BOT_RESERVED_STATIC_COMMANDS = [
  'start', 'init', 'output', 'status', 'restart', 'pair', 'help', BUILTIN_NEW_COMMAND,
];

export const BOT_STATIC_COMMANDS = [
  ...BOT_RESERVED_STATIC_COMMANDS,
  ...Object.values(DEFAULT_BUILTIN_COMMANDS),
];

const BUILTIN_DESCRIPTION_KEYS: Record<BotBuiltinCommandKey, string> = {
  agent: 'telegram.commands.agent',
  search: 'telegram.commands.search',
};

export interface ResolvedBuiltinCommand {
  key: BotBuiltinCommandKey;
  command: string;
  targetUrl: string;
  descriptionKey: string;
}

export const PROVIDER_ALIASES: Record<string, Provider> = (() => {
  const table: Record<string, Provider> = {};
  for (const provider of PROVIDERS) {
    table[provider] = provider;
    table[DEFAULT_PROVIDER_COMMANDS[provider]] = provider;
  }
  return table;
})();

function sanitizeCommandName(raw: string): string {
  const name = raw.trim().toLowerCase();
  return BOT_COMMAND_RE.test(name) ? name : '';
}

export function resolveProviderCommands(
  providerCommands: Record<Provider, BotProviderCommand> | undefined,
  extraReserved: string[] = [],
): ResolvedProviderCommand[] {
  const taken = new Set<string>([...BOT_STATIC_COMMANDS, ...extraReserved]);
  const resolved: ResolvedProviderCommand[] = [];

  for (const provider of PROVIDERS) {
    const cfg = providerCommands?.[provider];
    if (!cfg || cfg.enabled === false) continue;

    const def = DEFAULT_PROVIDER_COMMANDS[provider];
    const wanted = sanitizeCommandName(cfg.command) || def;
    const command = !taken.has(wanted)
      ? wanted
      : (!taken.has(def) ? def : '');
    if (!command) continue;
    taken.add(command);

    const modelId = provider === 'duckai' ? (cfg.modelId ?? '').trim() : '';
    const targetUrl = provider === 'duckai' && modelId
      ? buildDuckaiModelUrl(modelId)
      : PROVIDER_URLS[provider];

    resolved.push({
      provider,
      command,
      targetUrl,
      descriptionKey: PROVIDER_DESCRIPTION_KEYS[provider],
    });
  }

  return resolved;
}

export function resolveBuiltinCommands(
  builtinCommands: BotBuiltinCommands | undefined,
  extraReserved: string[] = [],
  hidden?: HiddenSources,
): ResolvedBuiltinCommand[] {
  const taken = new Set<string>([...BOT_RESERVED_STATIC_COMMANDS, ...extraReserved]);
  const resolved: ResolvedBuiltinCommand[] = [];

  for (const key of BOT_BUILTIN_COMMAND_KEYS) {
    const cfg = builtinCommands?.[key];
    if (!cfg || cfg.enabled === false) continue;

    const def = DEFAULT_BUILTIN_COMMANDS[key];
    const wanted = sanitizeCommandName(cfg.command) || def;
    const command = !taken.has(wanted) ? wanted : (!taken.has(def) ? def : '');
    if (!command) continue;
    taken.add(command);

    const targetUrl = cfg.targetUrl && hidden && isModelUrlHidden(cfg.targetUrl, hidden)
      ? ''
      : cfg.targetUrl;

    resolved.push({ key, command, targetUrl, descriptionKey: BUILTIN_DESCRIPTION_KEYS[key] });
  }

  return resolved;
}

export interface BotCommandSet {
  providers: ResolvedProviderCommand[];
  byok: ByokCommandDef[];
  builtins: ResolvedBuiltinCommand[];
}

export interface BotCommandSources {
  providerCommands: Record<Provider, BotProviderCommand> | undefined;
  builtinCommands: BotBuiltinCommands | undefined;
  byokInstances: Array<{ id: string; name: string }>;
  byokGroups: Array<{ id: string; name: string; memberIds: string[] }>;
  byokEnabled?: BotByokCommands;
  flowCommands: string[];
  hidden: HiddenSources;
}

export function resolveBotCommandSet(sources: BotCommandSources): BotCommandSet {
  const { providerCommands, builtinCommands, byokInstances, byokGroups, flowCommands, hidden } = sources;
  const builtins = resolveBuiltinCommands(builtinCommands, flowCommands, hidden);
  const builtinNames = builtins.map((bc) => bc.command);
  const providers = resolveProviderCommands(providerCommands, [...flowCommands, ...builtinNames]);
  const byok = resolveByokCommands(byokInstances, byokGroups, [
    ...BOT_STATIC_COMMANDS,
    ...Object.keys(PROVIDER_ALIASES),
    ...providers.map((pc) => pc.command),
    ...flowCommands,
    ...builtinNames,
  ], sources.byokEnabled);
  const visible = <T extends { targetUrl: string }>(commands: T[]): T[] =>
    commands.filter((cmd) => !isModelUrlHidden(cmd.targetUrl, hidden));
  return { providers: visible(providers), byok: visible(byok), builtins };
}

export function resolveLlmDirectTarget(
  direct: BotLlmDirectConfig,
  hidden: HiddenSources,
): BotLlmDirectConfig {
  if (!direct.targetUrl || !isModelUrlHidden(direct.targetUrl, hidden)) return direct;
  return { ...direct, targetUrl: '' };
}
