import { config } from '../config';
import { BOT_STATIC_COMMANDS, PROVIDER_ALIASES, resolveProviderCommands } from '../providerCommands';
import type { ResolvedProviderCommand } from '../providerCommands';
import { resolveByokCommands } from '../byokCommands';
import type { ByokCommandDef } from '../byokCommands';
import type { FlowManager } from '../flow';

// Telegram and LINE share one provider-command config, so they must also share
// the resolution: the same settings resolving to different command names per
// platform is exactly the divergence this replaced. Called on every incoming
// message, never cached — a renamed command answers without a restart.
export function resolveBotCommands(getFlowManager: () => FlowManager | null): {
  providers: ResolvedProviderCommand[];
  byok: ByokCommandDef[];
} {
  const flowCommands = (getFlowManager()?.getBotCommands() ?? []).map((fc) => fc.command);
  const providers = resolveProviderCommands(config.providerCommands, flowCommands);
  // Both provider spellings stay reserved even when unclaimed here: LINE also
  // answers the alias, so a BYOK key named 'ChatGPT' would otherwise mean the
  // API key on Telegram and the web provider on LINE.
  const byok = resolveByokCommands(config.byokInstances, config.byokGroups, [
    ...BOT_STATIC_COMMANDS,
    ...Object.keys(PROVIDER_ALIASES),
    ...providers.map((pc) => pc.command),
    ...flowCommands,
  ]);
  return { providers, byok };
}
