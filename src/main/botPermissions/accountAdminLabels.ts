/**
 * The words on the account cards that both platforms draw the same way: a grant's name on its
 * toggle, a list row's kind, and the "more in settings" lines under a capped list.
 */
import { ALL_CONNECTORS_GRANT, CONNECTOR_GRANT_PREFIX } from '../../shared/botPermissions';
import type { BotGrant } from '../../shared/botPermissions';
import { BUILTIN_CONNECTOR_TITLES } from '../../shared/builtinConnectors';
import { t } from '../i18n';
import type { ManagedAccount } from './accountAdminPlan';

/** A grant's name on a toggle. */
export function accountGrantLabel(grant: BotGrant, strings: Record<string, string>): string {
  if (grant === ALL_CONNECTORS_GRANT) return t(strings, 'telegram.users.grant.allConnectors');
  if (!grant.startsWith(CONNECTOR_GRANT_PREFIX)) return t(strings, `telegram.users.grant.${grant}`);
  const id = grant.slice(CONNECTOR_GRANT_PREFIX.length);
  const key = BUILTIN_CONNECTOR_TITLES[id];
  return key ? t(strings, key) : id;
}

/** A list row's i18n key: the name with what the account is. */
export function accountListItemKey(account: ManagedAccount): string {
  if (account.state === 'requested') return 'telegram.users.list.requestedItem';
  if (account.owner) return 'telegram.users.list.ownerItem';
  if (account.admin) return 'telegram.users.list.adminItem';
  return 'telegram.users.list.pairedItem';
}

/** The "more in settings" lines under a capped list. */
export function accountListMoreLines(plan: { morePaired: number; moreRequests: number }, strings: Record<string, string>): string[] {
  return [
    ...(plan.morePaired > 0 ? [t(strings, 'telegram.users.list.morePaired', { count: String(plan.morePaired) })] : []),
    ...(plan.moreRequests > 0 ? [t(strings, 'telegram.users.list.moreRequests', { count: String(plan.moreRequests) })] : []),
  ];
}
