/**
 * The platform-neutral half of managing a group from a chat card: which grants a card offers, in
 * which order (a button names its grant by index here, never by name), and what a press asks for
 * against the group as it is now. Telegram's and LINE's group cards both use it.
 */
import { GROUP_CAPABILITIES } from '../../shared/botCapabilities';
import { PUBLIC_DATA_CONNECTOR_IDS } from '../../shared/builtinConnectors';
import { PRESELECTED_GROUP_GRANTS, connectorGrant, normalizeGroupGrantList } from '../../shared/botPermissions';
import type { BotGroupGrant } from '../../shared/botPermissions';

/** Everything a group may grant, in a fixed order: a toggle names its grant by index here. */
export const GROUP_GRANT_CANDIDATES: readonly BotGroupGrant[] = [
  ...GROUP_CAPABILITIES,
  ...PUBLIC_DATA_CONNECTOR_IDS.map(connectorGrant),
];

export interface ManagedGroup {
  id: string;
  title?: string;
  /** Waiting for approval: the bot answers nobody there. */
  pending: boolean;
  grants: readonly BotGroupGrant[];
}

export type GroupCardAction =
  | { op: 'list' }
  | { op: 'view' | 'allow' | 'revoke'; chatId: string }
  | { op: 'toggle'; chatId: string; index: number };

export interface PlannedGroupChange {
  /** Absent = no write; null = back to pending. */
  grants?: BotGroupGrant[] | null;
  /** The i18n key that says it was done. */
  done?: string;
  /** The i18n key to show instead of writing. */
  refusal?: string;
}

/**
 * What a press asks for, against the group as it is now — the settings page or another card may
 * have changed it since this card was drawn, so a stale "Allow" on an allowed group changes nothing.
 */
export function planGroupChange(action: Exclude<GroupCardAction, { op: 'list' }>, group: ManagedGroup): PlannedGroupChange {
  switch (action.op) {
    case 'view':
      return {};
    case 'allow':
      return group.pending ? { grants: [...PRESELECTED_GROUP_GRANTS], done: 'telegram.groups.toast.allowed' } : {};
    case 'revoke':
      return group.pending ? {} : { grants: null, done: 'telegram.groups.toast.revoked' };
    case 'toggle': {
      if (group.pending) return { refusal: 'telegram.groups.toast.pendingFirst' };
      const grant = GROUP_GRANT_CANDIDATES[action.index];
      if (!grant) return {};
      const next = group.grants.includes(grant)
        ? group.grants.filter((g) => g !== grant)
        : [...group.grants, grant];
      return { grants: normalizeGroupGrantList(next), done: 'telegram.groups.toast.saved' };
    }
  }
}
