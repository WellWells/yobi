import {
  DEFAULT_PROVIDER_COMMANDS,
  PROVIDERS,
  PROVIDER_URLS,
  TELEGRAM_COMMAND_RE,
  buildDuckaiModelUrl,
} from '../../shared/types';
import type { Provider } from '../../shared/types';
import type { TelegramConfig } from '../configTypes';

export interface ResolvedProviderCommand {
  provider: Provider;
  command: string;
  targetUrl: string;
  descriptionKey: string;
}

const PROVIDER_DESCRIPTION_KEYS: Record<Provider, string> = {
  chatgpt: 'telegram.commands.gpt',
  gemini: 'telegram.commands.gemini',
  perplexity: 'telegram.commands.pplx',
  duckai: 'telegram.commands.duck',
};

const RESERVED_COMMANDS = ['start', 'init', 'output', 'status'];

function sanitizeCommandName(raw: string): string {
  const name = raw.trim().toLowerCase();
  return TELEGRAM_COMMAND_RE.test(name) ? name : '';
}

export function resolveProviderCommands(
  telegram: TelegramConfig,
  extraReserved: string[] = [],
): ResolvedProviderCommand[] {
  const taken = new Set<string>([...RESERVED_COMMANDS, ...extraReserved]);
  const resolved: ResolvedProviderCommand[] = [];

  for (const provider of PROVIDERS) {
    const cfg = telegram.providerCommands?.[provider];
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
