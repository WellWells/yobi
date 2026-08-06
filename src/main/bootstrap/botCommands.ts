import { buildByokGroupUrl, buildByokUrl, isModelUrlHidden } from '../../shared/types';
import type { BotByokCommandInfo } from '../../shared/types';
import { config, getHiddenSources } from '../config';
import { resolveBotCommandSet } from '../providerCommands';
import type { BotCommandSet } from '../providerCommands';
import type { FlowManager } from '../flow';

export function resolveBotCommands(getFlowManager: () => FlowManager | null): BotCommandSet {
  return resolveBotCommandSet({
    providerCommands: config.providerCommands,
    builtinCommands: config.builtinCommands,
    byokInstances: config.byokInstances,
    byokGroups: config.byokGroups,
    byokEnabled: config.botByokCommands,
    flowCommands: (getFlowManager()?.getBotCommands() ?? []).map((fc) => fc.command),
    hidden: getHiddenSources(),
  });
}

/**
 * Every BYOK key and group as the settings page needs to show it. The command name is the
 * one the bots really registered — resolved here rather than in the renderer, which cannot
 * see flow commands and so would preview names that clash. Switched-off entries get the
 * name they would take, from a second pass that ignores the opt-outs.
 */
export function listBotByokCommands(getFlowManager: () => FlowManager | null): BotByokCommandInfo[] {
  const hidden = getHiddenSources();
  const live = new Map(resolveBotCommands(getFlowManager).byok.map((bc) => [bc.targetUrl, bc.command]));
  // Ignoring both the opt-outs and the hiding gives a switched-off or hidden entry the name
  // it would take, so its row reads as a name rather than as a blank.
  const previewSet = resolveBotCommandSet({
    providerCommands: config.providerCommands,
    builtinCommands: config.builtinCommands,
    byokInstances: config.byokInstances,
    byokGroups: config.byokGroups,
    flowCommands: (getFlowManager()?.getBotCommands() ?? []).map((fc) => fc.command),
    hidden: { providers: [], duckaiModelIds: [], byokIds: [], byokGroupIds: [] },
  });
  const preview = new Map(previewSet.byok.map((bc) => [bc.targetUrl, bc.command]));

  const row = (id: string, name: string, kind: 'key' | 'group', targetUrl: string): BotByokCommandInfo => ({
    id,
    kind,
    name,
    command: live.get(targetUrl) ?? preview.get(targetUrl) ?? '',
    enabled: config.botByokCommands[id] !== false,
    hidden: isModelUrlHidden(targetUrl, hidden),
  });

  return [
    ...config.byokInstances.map((instance) =>
      row(instance.id, instance.name, 'key', buildByokUrl(instance.id))),
    ...config.byokGroups
      .filter((group) => group.memberIds.length > 0)
      .map((group) => row(group.id, group.name, 'group', buildByokGroupUrl(group.id))),
  ];
}
