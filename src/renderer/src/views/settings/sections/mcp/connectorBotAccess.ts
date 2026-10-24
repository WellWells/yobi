import { connectorGrant } from '../../../../../../shared/botPermissions';
import { anyBotEnabled, whoCanUse, whoCanUseText } from '../botPermissionsView';
import type { BotRoster } from '../botPermissionsView';

export interface ConnectorBotAccess {
  /** One line for the whole page: connectors with no caption of their own are the owner's alone. */
  summary?: string;
  /** Per-card lines, only for connectors whose access differs from that default. */
  captions: ReadonlyMap<string, string>;
}

/**
 * Who may use each added connector through the bots. Almost every card used to repeat
 * "only you", so that default is stated once and a card only speaks up when it differs.
 * Nothing at all while both bots are off.
 */
export function connectorBotAccess(
  roster: BotRoster,
  serverIds: readonly string[],
  t: (key: string) => string,
): ConnectorBotAccess {
  const captions = new Map<string, string>();
  if (!anyBotEnabled(roster)) return { captions };
  let ownerOnlyAny = false;
  for (const id of serverIds) {
    const who = whoCanUse(roster, connectorGrant(id));
    if (who.owner && who.labels.length === 0) {
      ownerOnlyAny = true;
      continue;
    }
    captions.set(id, whoCanUseText(who, 'connector', t));
  }
  return ownerOnlyAny ? { summary: t('settings.mcp.botAccess.default'), captions } : { captions };
}
