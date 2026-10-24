/**
 * Every capability a Telegram / LINE bot user can be given, with its defaults in one row each.
 * `resolveBotRights` and the settings page read this table; nothing else decides who gets what.
 * A capability added without a row here fails typecheck (botPermissions.ts checks the grant list
 * against it).
 *
 * The audiences: the owner ("me"), a paired account with no grants, and a group — where a group's
 * own grants reach everyone in it, paired or not, once the owner has allowed that group.
 */
import { PUBLIC_DATA_CONNECTOR_IDS } from './builtinConnectors';

export type BotCapabilityKey = 'chat' | 'web' | 'download' | 'preview' | 'agent' | 'local' | 'shell' | 'admin' | 'connectors';

export interface BotCapability {
  /** The "me" mark implies it. */
  owner: boolean;
  /** A paired account has it with no grant at all. */
  paired: boolean;
  /** It reaches group chats at all (through an account's own grant or the group's). */
  inGroups: boolean;
  /** A group may grant it to everyone in it, paired or not. */
  groupGrantable: boolean;
  /**
   * Ticked when the owner allows a group. A group the bot joins gets nothing — not even for paired
   * accounts — until the owner allows it in settings; allowing writes these, which stay editable.
   */
  groupPreselected: boolean;
}

/**
 * - chat: talking to the bot at all, on the chat kit of public lookups (YouTube, Maps reviews,
 *   weather, air quality, stocks, exchange rates, random). Pairing is chat.
 * - web, download: reach the internet for whoever asks — fine for a group, off until granted.
 * - preview: a pasted video link brings a low-quality copy of a short video before the menu (with
 *   download only). A choice even for "me", so never implied; a group cannot grant it, while an
 *   account's own grant still works in one.
 * - agent: the full kit acts on the owner's computer and accounts (LLM steps, notifications,
 *   connector calls), so a group never grants it; a paired account's own grant still works there.
 * - local, shell: this computer; private chats only. shell is never implied, not even by "me".
 * - admin: /status, /restart, /output — the outputs are the owner's, so private chats only.
 * - connectors: the owner's own data; private chats only. A connector of public data alone
 *   (`publicDataConnector`) is the exception.
 */
export const BOT_CAPABILITIES: Readonly<Record<BotCapabilityKey, BotCapability>> = {
  chat: { owner: true, paired: true, inGroups: true, groupGrantable: true, groupPreselected: true },
  web: { owner: true, paired: false, inGroups: true, groupGrantable: true, groupPreselected: false },
  download: { owner: true, paired: false, inGroups: true, groupGrantable: true, groupPreselected: false },
  preview: { owner: false, paired: false, inGroups: true, groupGrantable: false, groupPreselected: false },
  agent: { owner: true, paired: false, inGroups: true, groupGrantable: false, groupPreselected: false },
  local: { owner: true, paired: false, inGroups: false, groupGrantable: false, groupPreselected: false },
  shell: { owner: false, paired: false, inGroups: false, groupGrantable: false, groupPreselected: false },
  admin: { owner: false, paired: false, inGroups: false, groupGrantable: false, groupPreselected: false },
  connectors: { owner: true, paired: false, inGroups: false, groupGrantable: false, groupPreselected: false },
};

/** A connector that reads only public data: everything a group may have of it, preselected too. */
const PUBLIC_DATA_CONNECTOR: BotCapability = { owner: true, paired: false, inGroups: true, groupGrantable: true, groupPreselected: true };

/** One connector's row: the public-data exception, or the connectors row. */
export function connectorCapability(serverId: string): BotCapability {
  return PUBLIC_DATA_CONNECTOR_IDS.includes(serverId) ? PUBLIC_DATA_CONNECTOR : BOT_CAPABILITIES.connectors;
}

/** The capabilities (besides public-data connectors) a group may grant — the table's `groupGrantable`. */
export type BotGroupCapability = 'chat' | 'web' | 'download';
export const GROUP_CAPABILITIES: readonly BotGroupCapability[] = ['chat', 'web', 'download'];
