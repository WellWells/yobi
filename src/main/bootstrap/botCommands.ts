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

export function listBotByokCommands(getFlowManager: () => FlowManager | null): BotByokCommandInfo[] {
  const hidden = getHiddenSources();
  const live = new Map(resolveBotCommands(getFlowManager).byok.map((bc) => [bc.targetUrl, bc.command]));
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
