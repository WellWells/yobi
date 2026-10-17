/**
 * What the settings page shows for a bot's groups and the people who used it, derived from the
 * same capability table main decides with (`shared/botCapabilities.ts`): a group's menu offers
 * exactly what a group may grant. Pure: no React, no IPC.
 */
import { GROUP_CAPABILITIES } from '../../../../../shared/botCapabilities';
import { PUBLIC_DATA_CONNECTOR_IDS } from '../../../../../shared/builtinConnectors';
import { CONNECTOR_GRANT_PREFIX, PRESELECTED_GROUP_GRANTS, connectorGrant, normalizeGroupGrantList } from '../../../../../shared/botPermissions';
import type { BotGroupGrant } from '../../../../../shared/botPermissions';
import type { BotAudienceUser } from '../../../../../shared/types';
import type { BotConnectorOption } from './botPermissionsView';

type Translate = (key: string) => string;

export interface GroupGrantItem {
  grant: BotGroupGrant;
  label: string;
  description: string;
}

export function groupGrantItem(grant: BotGroupGrant, connectors: readonly BotConnectorOption[], t: Translate): GroupGrantItem {
  switch (grant) {
    case 'chat':
      return { grant, label: t('settings.bot.group.grant.chat'), description: t('settings.bot.group.grant.chat.desc') };
    case 'web':
      return { grant, label: t('settings.bot.perm.grant.web'), description: t('settings.bot.group.grant.web.desc') };
    case 'download':
      return { grant, label: t('settings.bot.perm.grant.download'), description: t('settings.bot.perm.grant.download.desc') };
    default: {
      const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
      const known = connectors.find((option) => option.id === id);
      return {
        grant,
        label: known ? known.name : t('settings.bot.perm.grant.missingConnector'),
        description: t('settings.bot.group.grant.connector.desc'),
      };
    }
  }
}

/** The chips of a group's grants, in the order the table lists them. */
export function groupGrantChips(grants: readonly BotGroupGrant[], connectors: readonly BotConnectorOption[], t: Translate): GroupGrantItem[] {
  return normalizeGroupGrantList(grants).map((grant) => groupGrantItem(grant, connectors, t));
}

/** What a group's "+" menu offers: what a group may grant, minus what it has; connectors only when switched on. */
export function groupGrantMenu(grants: readonly BotGroupGrant[], connectors: readonly BotConnectorOption[], t: Translate): GroupGrantItem[] {
  const has = new Set(grants);
  const candidates: BotGroupGrant[] = [
    ...GROUP_CAPABILITIES,
    ...PUBLIC_DATA_CONNECTOR_IDS.filter((id) => connectors.some((option) => option.id === id)).map(connectorGrant),
  ];
  return candidates.filter((grant) => !has.has(grant)).map((grant) => groupGrantItem(grant, connectors, t));
}

/** What "Allow" writes for a pending group: the table's preselected rows, editable afterwards. */
export function allowGroupGrants(): BotGroupGrant[] {
  return [...PRESELECTED_GROUP_GRANTS];
}

export function addGroupGrant(grants: readonly BotGroupGrant[], grant: BotGroupGrant): BotGroupGrant[] {
  return normalizeGroupGrantList([...grants, grant]);
}

export function removeGroupGrant(grants: readonly BotGroupGrant[], grant: BotGroupGrant): BotGroupGrant[] {
  return normalizeGroupGrantList(grants.filter((g) => g !== grant));
}

/** Where someone last used the bot: the group's name, or "private chat". */
export function userWhere(user: BotAudienceUser, t: Translate): string {
  return user.where || t('settings.bot.users.private');
}
