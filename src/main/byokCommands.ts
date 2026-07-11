import { BOT_COMMAND_RE, buildByokGroupUrl, buildByokUrl } from '../shared/types';

// A BYOK key or key group exposed as a bot slash command ('/mykey what is…').
// Platform-neutral: Telegram folds these into its live command resolution, the
// LINE dispatcher looks them up per message.
export interface ByokCommandDef {
  command: string;
  targetUrl: string;
  // The instance/group name as configured, for command menus and /help.
  label: string;
}

// 'My Key-2' → 'my_key_2'. Names that reduce to nothing (e.g. pure CJK) or start
// with a digit get no command — the key stays reachable through the command-free
// chat provider picker.
//
// Exported for the test suite: pure, offline, deterministic.
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

// First taken name wins: reserved (built-in/provider/flow commands) beat BYOK,
// instances beat groups, config order breaks ties among duplicates.
//
// Exported for the test suite: pure, offline, deterministic.
export function resolveByokCommands(
  instances: Array<{ id: string; name: string }>,
  groups: Array<{ id: string; name: string; memberIds: string[] }>,
  reserved: Iterable<string>,
): ByokCommandDef[] {
  const taken = new Set(reserved);
  const out: ByokCommandDef[] = [];
  const add = (name: string, targetUrl: string): void => {
    const command = sanitizeByokCommandName(name);
    if (!command || taken.has(command)) return;
    taken.add(command);
    out.push({ command, targetUrl, label: name });
  };
  for (const instance of instances) add(instance.name, buildByokUrl(instance.id));
  // Empty groups (every member key deleted) would only throw at run time, so
  // they get no command — mirrors the renderer's model picker.
  for (const group of groups) {
    if (group.memberIds.length === 0) continue;
    add(group.name, buildByokGroupUrl(group.id));
  }
  return out;
}
