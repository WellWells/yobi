/**
 * Which manager issued a pairing code from Telegram (`/invite`), so the one who sent the link
 * hears when it is used and gets the new account's card to set its grants. In memory only: a
 * restart forgets it, and the pairing itself is unaffected.
 */
import { t } from '../i18n';
import { actorEnv } from './accountAdmin';
import type { AccountAdminDeps } from './accountAdmin';
import { accountCardView, accountName } from './accountAdminViews';
import type { GroupAdminView } from './groupAdmin';

export { InviteIssuers } from '../botPermissions/invites';

/**
 * Someone paired with a code a manager issued here: that manager gets the new account's card,
 * as long as they still are a manager. Errors are logged, never thrown.
 */
export async function tellInviteIssuer(input: {
  issuerId: number;
  userId: number;
  deps: AccountAdminDeps;
  isManager: (managerId: number) => Promise<boolean>;
  send: (chatId: number, view: GroupAdminView) => Promise<unknown>;
  strings: Record<string, string>;
  onLog: (message: string) => void;
}): Promise<void> {
  const { issuerId, userId, deps, strings, onLog } = input;
  try {
    if (issuerId === userId || !(await input.isManager(issuerId))) return;
    const account = await deps.getAccount(String(userId));
    if (account?.state !== 'paired') return;
    const env = await actorEnv(issuerId, deps, strings);
    const heading = t(strings, 'telegram.invite.used', { name: accountName(account) });
    await input.send(issuerId, accountCardView(account, env, { heading }));
  } catch (err: unknown) {
    onLog(`[telegram] could not tell ${issuerId} that their invite was used: ${err instanceof Error ? err.message : String(err)}`);
  }
}
