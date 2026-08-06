import { BOT_COMMAND_RE, buildByokGroupUrl, buildByokUrl } from '../shared/types';
import type { BotByokCommands } from '../shared/types';

export interface ByokCommandDef {
  command: string;
  targetUrl: string;
  label: string;
}

export function sanitizeByokCommandName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return BOT_COMMAND_RE.test(slug) ? slug : '';
}

/**
 * A key or group switched off in settings is left out entirely rather than skipped late,
 * so it does not hold its name hostage from the ones that stayed on.
 */
export function resolveByokCommands(
  instances: Array<{ id: string; name: string }>,
  groups: Array<{ id: string; name: string; memberIds: string[] }>,
  reserved: Iterable<string>,
  enabled: BotByokCommands = {},
): ByokCommandDef[] {
  const taken = new Set(reserved);
  const out: ByokCommandDef[] = [];
  const add = (id: string, name: string, targetUrl: string): void => {
    if (enabled[id] === false) return;
    const command = sanitizeByokCommandName(name);
    if (!command || taken.has(command)) return;
    taken.add(command);
    out.push({ command, targetUrl, label: name });
  };
  for (const instance of instances) add(instance.id, instance.name, buildByokUrl(instance.id));
  for (const group of groups) {
    if (group.memberIds.length === 0) continue;
    add(group.id, group.name, buildByokGroupUrl(group.id));
  }
  return out;
}
