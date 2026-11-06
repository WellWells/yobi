import { sendLog } from '../helpers';
import { defaultClient, refreshCalDavAccount } from './calDavAccounts';
import { listDavAccounts } from './calDavStore';

/**
 * Each CalDAV account's calendar list, kept fresh for whoever reads calendars (the AI's tools, the
 * calendar step): a list older than `CALENDAR_LIST_FRESH_MS` is read again first, so a calendar
 * made on the phone is there without a trip to Settings. Events are never cached; every read asks
 * the server. Accounts refresh side by side, a refresh already running is joined, and a slow
 * server is waited on for `CALENDAR_LIST_WAIT_MS` at most: the read then uses the last list.
 */

/** How old a calendar list may be when calendars are read (bursts of calls within a request refresh once). */
export const CALENDAR_LIST_FRESH_MS = 60_000;
/** How long a read waits for a slow server's list; the refresh goes on in the background. */
export const CALENDAR_LIST_WAIT_MS = 5_000;

export interface FreshnessAccount {
  id: string;
  username: string;
  unreadable: boolean;
}

export interface FreshnessDeps {
  accounts: () => FreshnessAccount[];
  /** True when the list was read and stored. */
  refresh: (accountId: string) => Promise<boolean>;
  now: () => number;
}

export interface CalendarFreshness {
  /** Refreshes the lists that are due; names the accounts whose list may be out of date. */
  freshen: () => Promise<string[]>;
  /** A list just read elsewhere (Settings' refresh, a new account) counts as fresh. */
  markFresh: (accountId: string) => void;
}

export function createCalendarFreshness(deps: FreshnessDeps): CalendarFreshness {
  // When the last refresh started, failed ones too: a server that is down is not asked on every call.
  const startedAt = new Map<string, number>();
  const running = new Map<string, Promise<boolean>>();

  function refreshOnce(accountId: string): Promise<boolean> {
    const current = running.get(accountId);
    if (current) return current;
    startedAt.set(accountId, deps.now());
    const job = deps.refresh(accountId)
      .catch(() => false)
      .finally(() => running.delete(accountId));
    running.set(accountId, job);
    return job;
  }

  function within(job: Promise<boolean>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      void job.then((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  }

  async function freshen(): Promise<string[]> {
    const outOfDate: string[] = [];
    const due: FreshnessAccount[] = [];
    for (const account of deps.accounts()) {
      if (account.unreadable) {
        outOfDate.push(account.username);
        continue;
      }
      const last = startedAt.get(account.id);
      if (running.has(account.id) || last === undefined || deps.now() - last >= CALENDAR_LIST_FRESH_MS) due.push(account);
    }
    await Promise.all(due.map(async (account) => {
      if (!await within(refreshOnce(account.id), CALENDAR_LIST_WAIT_MS)) outOfDate.push(account.username);
    }));
    return outOfDate;
  }

  return {
    freshen,
    markFresh: (accountId) => { startedAt.set(accountId, deps.now()); },
  };
}

let live: CalendarFreshness | null = null;

/** The app's one instance: the AI's tools, the calendar step and Settings share the timestamps. */
export function calendarFreshness(): CalendarFreshness {
  live ??= createCalendarFreshness({
    accounts: listDavAccounts,
    refresh: async (accountId) => (await refreshCalDavAccount(accountId, { client: defaultClient, log: sendLog })).ok,
    now: () => Date.now(),
  });
  return live;
}
