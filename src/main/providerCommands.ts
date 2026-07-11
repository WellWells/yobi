import {
  BOT_COMMAND_RE,
  DEFAULT_PROVIDER_COMMANDS,
  PROVIDERS,
  PROVIDER_URLS,
  buildDuckaiModelUrl,
} from '../shared/types';
import type { BotProviderCommand, Provider } from '../shared/types';

// One live-resolved slash command: a built-in provider or a BYOK key/group.
// Provider entries localize their menu description via descriptionKey; BYOK
// entries carry the configured name as a literal description instead.
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

// Names every bot answers itself, on either platform. The union is reserved on
// both so one shared config always resolves to the same command names — a name
// reserved only on Telegram would otherwise be free for a provider on LINE.
export const BOT_STATIC_COMMANDS = ['start', 'init', 'output', 'status', 'restart', 'pair', 'help'];

// '/chatgpt' and '/gpt' both name the same provider. Resolution prefers the
// configured command; these are the fallback spellings LINE also accepts.
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
