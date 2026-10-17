import { BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import { FlowUserError } from './flow/userError';
import { sendLog, sendWebNotification, setSiteVerificationOpener } from './helpers';
import { getLangCache, t } from './i18n';
import { openSignInWindow } from './signInWindow';
import { prepareSiteWindow } from './siteAccounts';
import { raceAbort } from './promiseRace';
import { siteLabel } from '../shared/linkSites/rows';

/*
 * A site's "are you human?" check that wants a click (such as Cloudflare's interactive challenge):
 * a hidden reader window can wait out the silent kind, never this one. When the person is at the computer, Yobi shows the challenge page in a
 * small window of its own — the sign-in windows' window, on the reader's own persistent partition,
 * with the same Chrome identity — and carries on with the read once it clears. The clearance
 * cookie stays in that partition, so later reads (a bot's, a schedule's) pass for as long as the
 * site honours it.
 *
 * Nobody is at the computer for a bot message or a scheduled flow: those never open a window.
 * The read fails with "needs a one-time verification in Yobi on your computer", and a desktop
 * notification offers the window; once it clears, the person sends the link again.
 *
 * One verification per site at a time: every read that runs into the challenge meanwhile waits
 * on the same window.
 */

/** How long the window waits for the person before the verification counts as not done. */
export const SITE_VERIFICATION_TIMEOUT_MS = 120_000;
/** A schedule that keeps running into the challenge raises one notification per site in this time. */
export const SITE_VERIFICATION_NOTICE_COOLDOWN_MS = 10 * 60_000;

export interface SiteVerificationRequest {
  /** The link-site id (`dcard`, `reddit`): the window's title names its label. */
  site: string;
  /** The reader's persistent partition: where the clearance cookie must end up. */
  partition: string;
  /** The page whose challenge the person answers (normally the page the read was opening). */
  url: string;
  /** Whether the page in the window is past the challenge. A destroyed window is never cleared. */
  isCleared(contents: WebContents): Promise<boolean>;
  /** The read's own Stop: the read stops waiting; the window stays for the person to finish. */
  signal?: AbortSignal;
}

/**
 * Thrown by a reader whose page wants a click nobody can give (a bot message, a schedule). A
 * `FlowUserError`, so a flow step words it in the user's language; its English message is also
 * mapped by `localizeUserFacingError` for the surfaces that only have the message.
 */
export class SiteVerificationRequired extends FlowUserError {
  constructor(readonly site: string) {
    const label = siteLabel(site);
    super('flow.error.siteVerificationNeeded', { site: label }, siteVerificationNeededMessage(label));
    this.name = 'SiteVerificationRequired';
  }
}

/** The English diagnostic `localizeUserFacingError` reads back (`SITE_VERIFICATION_NEEDED_RE`). */
export function siteVerificationNeededMessage(label: string): string {
  return `${label} needs a one-time verification in Yobi on this computer`;
}

function notCompleted(label: string, why: string): FlowUserError {
  return new FlowUserError('flow.error.siteVerificationIncomplete', { site: label }, `${label} verification was not completed (${why})`);
}

const inFlight = new Map<string, Promise<void>>();
/** The last request each site's notice offers: what the notification's action opens. */
const offered = new Map<string, Omit<SiteVerificationRequest, 'signal'>>();
const noticedAt = new Map<string, number>();

function openWindow({ site, partition, url, isCleared }: Omit<SiteVerificationRequest, 'signal'>): Promise<void> {
  const label = siteLabel(site);
  return new Promise<void>((resolve, reject) => {
    let contents: WebContents | null = null;
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const close = (): void => {
      if (contents && !contents.isDestroyed()) BrowserWindow.fromWebContents(contents)?.close();
    };
    const timer = setTimeout(() => {
      finish(notCompleted(label, `nothing within ${SITE_VERIFICATION_TIMEOUT_MS / 1_000} s`));
      close();
    }, SITE_VERIFICATION_TIMEOUT_MS);
    const cleared = async (): Promise<boolean> => {
      if (!contents || contents.isDestroyed()) return false;
      return isCleared(contents).catch(() => false);
    };
    sendLog(`🧩 [${label}] The page wants a person: opening its verification window`);
    openSignInWindow({
      id: `verify-${site}`,
      label,
      title: t(getLangCache(), 'siteVerify.title', { site: label }),
      partition,
      url,
      // The sign-in windows' Chrome identity, set on a blank page before the challenge loads.
      prepare: async (wc) => {
        contents = wc;
        await prepareSiteWindow(wc, label);
      },
      isSignedIn: cleared,
      onSignedIn: () => {
        sendLog(`🧩 [${label}] Verification passed`);
        finish();
      },
      onClosed: (passed) => finish(passed ? undefined : notCompleted(label, 'the window was closed')),
    }).then(
      (opened) => {
        if (!opened) finish(notCompleted(label, 'another sign-in window is open'));
      },
      (err: unknown) => finish(notCompleted(label, err instanceof Error ? err.message : String(err))),
    );
  });
}

/**
 * Shows the site's challenge in a visible window for the person to answer and resolves once
 * `isCleared` holds (the window then closes itself). Rejects with "verification not completed"
 * when the person closes the window, nothing happens for two minutes, or another sign-in window
 * is open; with the signal's reason on Stop. Only for a read the person started at the computer.
 */
export function requestSiteVerification(request: SiteVerificationRequest): Promise<void> {
  const { signal, ...spec } = request;
  let shared = inFlight.get(spec.site);
  if (!shared) {
    shared = openWindow(spec).finally(() => inFlight.delete(spec.site));
    inFlight.set(spec.site, shared);
  }
  // Stop ends only this read's wait, with the signal's reason; the window stays for anyone else.
  return raceAbort(shared, signal);
}

/** Opens the verification the site's notification offered; nothing when it offered none. */
export function openOfferedSiteVerification(site: string): void {
  const spec = offered.get(site);
  if (!spec) {
    sendLog(`🧩 No verification on offer for "${site}"`);
    return;
  }
  requestSiteVerification(spec).then(
    () => offered.delete(site),
    (err: unknown) => sendLog(`🧩 [${siteLabel(site)}] ${err instanceof Error ? err.message : String(err)}`),
  );
}

/**
 * For a read nobody at the computer started: offers the verification in a desktop notification
 * (once per site per `SITE_VERIFICATION_NOTICE_COOLDOWN_MS`) and returns the error to throw.
 */
export function offerSiteVerification(request: Omit<SiteVerificationRequest, 'signal'>): SiteVerificationRequired {
  const { site } = request;
  offered.set(site, request);
  setSiteVerificationOpener(openOfferedSiteVerification);
  const now = Date.now();
  const last = noticedAt.get(site) ?? 0;
  if (now - last >= SITE_VERIFICATION_NOTICE_COOLDOWN_MS) {
    noticedAt.set(site, now);
    const strings = getLangCache();
    const label = siteLabel(site);
    sendWebNotification(
      t(strings, 'siteVerify.notify.title', { site: label }),
      t(strings, 'siteVerify.notify.body', { site: label }),
      'warning',
      { id: 'open-site-verification', label: t(strings, 'siteVerify.notify.action'), site },
    );
  }
  sendLog(`🧩 [${siteLabel(site)}] The page wants a person, and nobody at the computer started this read`);
  return new SiteVerificationRequired(site);
}
