import { useCallback, useEffect, useMemo, useState } from 'react';
import { botApi } from '../../../api/electronApi';
import { showAppNotice } from '../../../hooks/useUiNotifications';
import { pruneSettledGrants, sameGrants } from '../sections/botPermissionsView';
import type { BotConnectorOption } from '../sections/botPermissionsView';
import type { BotGrant, BotSetDefaultGrantsFailure, BotSetPermissionsFailure } from '../../../../../shared/botPermissions';
import type { BotPlatform } from '../../../../../shared/types';
import type { BotSelfChange, UserMemoryBotSelf } from '../../../../../shared/userMemory';

/** What one platform's paired list needs to show and edit each account's grants. */
export interface BotAccessControls {
  platform: BotPlatform;
  connectors: readonly BotConnectorOption[];
  grantsFor: (userId: string) => BotGrant[];
  isOwner: (userId: string) => boolean;
  /**
   * The memory file has been read. Until then no account shows as "me", so the mark cannot be
   * edited: a click on an owner that only looks unmarked would be a misleading edit.
   */
  ownerKnown: boolean;
  setGrants: (userId: string, next: BotGrant[]) => void;
  setOwner: (userId: string, next: boolean) => void;
  /** What an account is given when it pairs with a code. */
  defaultGrants: BotGrant[];
  setDefaultGrants: (next: BotGrant[]) => void;
}

interface Options {
  platform: BotPlatform;
  /** The saved grants from the platform's settings snapshot. */
  saved: Record<string, BotGrant[]> | undefined;
  /** The saved defaults for new pairings, from the same snapshot. */
  savedDefaults: BotGrant[] | undefined;
  /** Re-reads the snapshot; the truth after a refused save. */
  reload: () => Promise<void>;
  botSelf: UserMemoryBotSelf | null | undefined;
  setBotSelf: (change: BotSelfChange) => Promise<void>;
  connectors: readonly BotConnectorOption[];
  t: (key: string) => string;
}

const FAILURE_KEYS: Record<BotSetPermissionsFailure, string> = {
  invalidRequest: 'settings.bot.perm.error.invalidRequest',
  notPaired: 'settings.bot.perm.error.notPaired',
  invalidGrant: 'settings.bot.perm.error.invalidGrant',
  adminUnavailable: 'settings.bot.perm.error.adminUnavailable',
};

const DEFAULT_FAILURE_KEYS: Record<BotSetDefaultGrantsFailure, string> = {
  invalidRequest: 'settings.bot.perm.error.invalidRequest',
  invalidGrant: 'settings.bot.perm.error.invalidGrant',
  explicitGrant: 'settings.bot.perm.error.explicitGrant',
};

const EMPTY: BotGrant[] = [];

/**
 * Per-account grant editing with an optimistic chip: the change shows at once, and a refused or
 * failed save drops it, re-reads the snapshot and says so in a notice. Owner ("me") edits go
 * through the memory file's `botSelf`, which stays the single place that mark is stored.
 */
export function useBotAccessControls({
  platform, saved, savedDefaults, reload, botSelf, setBotSelf, connectors, t,
}: Options): BotAccessControls {
  const [pending, setPending] = useState<Record<string, BotGrant[]>>({});
  const [pendingDefaults, setPendingDefaults] = useState<BotGrant[] | null>(null);

  useEffect(() => {
    setPending((current) => pruneSettledGrants(current, saved));
  }, [saved]);

  useEffect(() => {
    setPendingDefaults((current) => (current && sameGrants(current, savedDefaults ?? EMPTY) ? null : current));
  }, [savedDefaults]);

  const grantsFor = useCallback(
    (userId: string): BotGrant[] => pending[userId] ?? saved?.[userId] ?? EMPTY,
    [pending, saved],
  );

  const ownerKnown = Boolean(botSelf);
  const ownerIds = useMemo(() => botSelf?.[platform] ?? [], [botSelf, platform]);
  const isOwner = useCallback((userId: string) => ownerIds.includes(userId), [ownerIds]);

  const fail = useCallback((userId: string, next: BotGrant[], reasonKey: string) => {
    setPending((current) => {
      // A newer edit to the same account owns the chip now; leave it to its own answer.
      if (current[userId] !== next) return current;
      const rest = { ...current };
      delete rest[userId];
      return rest;
    });
    showAppNotice({ level: 'error', title: t('settings.bot.perm.saveFailed'), message: t(reasonKey) });
    void reload();
  }, [reload, t]);

  const setGrants = useCallback((userId: string, next: BotGrant[]) => {
    setPending((current) => ({ ...current, [userId]: next }));
    void (async () => {
      try {
        const result = await botApi.setPermissions({ platform, userId, grants: next });
        if (!result.ok) {
          fail(userId, next, FAILURE_KEYS[result.reason]);
          return;
        }
        setPending((current) => (current[userId] === next ? { ...current, [userId]: result.grants } : current));
        // Main also broadcasts the change; reading it here too means the chip never outlives
        // a snapshot that missed that broadcast.
        void reload();
      } catch {
        fail(userId, next, 'settings.bot.perm.error.unknown');
      }
    })();
  }, [platform, fail, reload]);

  // Only this account's mark is sent; main applies it to the file as it is then, so the other
  // marks survive a stale or missing snapshot here.
  const setOwner = useCallback((userId: string, next: boolean) => {
    if (!ownerKnown) return;
    void setBotSelf({ platform, userId, self: next }).catch(() => {
      showAppNotice({ level: 'error', title: t('settings.bot.perm.saveFailed'), message: t('settings.bot.perm.error.unknown') });
    });
  }, [ownerKnown, platform, setBotSelf, t]);

  const defaultGrants = pendingDefaults ?? savedDefaults ?? EMPTY;

  const setDefaultGrants = useCallback((next: BotGrant[]) => {
    setPendingDefaults(next);
    const failDefaults = (reasonKey: string): void => {
      // A newer edit owns the chips now; leave it to its own answer.
      setPendingDefaults((current) => (current === next ? null : current));
      showAppNotice({ level: 'error', title: t('settings.bot.perm.saveFailed'), message: t(reasonKey) });
      void reload();
    };
    void (async () => {
      try {
        const result = await botApi.setDefaultGrants({ platform, grants: next });
        if (!result.ok) {
          failDefaults(DEFAULT_FAILURE_KEYS[result.reason]);
          return;
        }
        setPendingDefaults((current) => (current === next ? result.grants : current));
        void reload();
      } catch {
        failDefaults('settings.bot.perm.error.unknown');
      }
    })();
  }, [platform, reload, t]);

  return useMemo(
    () => ({ platform, connectors, grantsFor, isOwner, ownerKnown, setGrants, setOwner, defaultGrants, setDefaultGrants }),
    [platform, connectors, grantsFor, isOwner, ownerKnown, setGrants, setOwner, defaultGrants, setDefaultGrants],
  );
}
