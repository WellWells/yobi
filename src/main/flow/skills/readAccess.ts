import { SITE_ACCOUNT_LABELS } from '../../../shared/types';
import type { SiteAccount } from '../../../shared/types';
import { FlowUserError } from '../userError';
import type { XThread } from './xPosts';

/*
 * What a pasted-link step may use when it reads the link, from the fields the executor fills in
 * for it (`resolveStepConfig`). The run decides them once (`FlowManager`); a step only reads them.
 */

/**
 * How far a run may use the site sign-ins in Settings (X, Instagram, Facebook, bilibili) — the
 * owner's own accounts (`botPermissions/signedInReads.ts`):
 * - `full`: runs not started by a bot (the desktop, schedules), and an admin of the bot (the owner,
 *   or a Telegram account with the admin grant) in their own private chat.
 * - `others`: every other bot message: what can be told to be for friends only is for admins
 *   alone, everything else is public. A post is read as a visitor first; only when a
 *   visitor cannot see it, the sign-in reads it, and a post its site marks as shown to some people
 *   only is refused whole (`threadForOthers`). Stories and profiles never: viewing them is the
 *   owner's account seen looking.
 * - `none`: no sign-in at all; a bot run whose sender cannot be told.
 */
export type SignInUse = 'full' | 'others' | 'none';

export interface ReadAccess {
  /** The person started the run at the computer: a site's verification window may be shown. */
  interactive: boolean;
  /** How far the sign-ins in Settings may be used (`SignInUse`). Anything unknown is `none`. */
  signIn: SignInUse;
}

/** The run's mark as a step reads it: exactly `full` or `others`, anything else `none` (fail closed). */
export function signInUseOf(mark: string | undefined): SignInUse {
  return mark === 'full' || mark === 'others' ? mark : 'none';
}

export function readAccessOf(config: Readonly<Record<string, string>>): ReadAccess {
  return { interactive: config.__interactive === '1', signIn: signInUseOf(config.__signedIn) };
}

/**
 * The link shows its content only signed in, and this read may not use the sign-in for it. Never
 * "sign in in Settings", which the person in the chat cannot do and must not be asked to.
 */
export function signedInOnlyError(site: SiteAccount, url: string): FlowUserError {
  const label = SITE_ACCOUNT_LABELS[site];
  return new FlowUserError(
    'flow.error.othersSignedInOnly',
    { site: label },
    `${label} shows this only signed in, and this run may not use the sign-in for it: ${url}`,
  );
}

/** A visitor's read found the post shown only signed in: the one failure a signed-in read may follow. */
export function isSignedInOnly(err: unknown): boolean {
  return err instanceof FlowUserError && err.key === 'flow.error.othersSignedInOnly';
}

/** Stories and profiles, for anyone but an admin: viewing them with the sign-in is the owner seen looking. */
export function notForOthersError(site: SiteAccount, url: string): FlowUserError {
  const label = SITE_ACCOUNT_LABELS[site];
  return new FlowUserError(
    'flow.error.othersNoStories',
    { site: label },
    `${label} stories and profiles are read only for an admin in a private chat with the bot: ${url}`,
  );
}

/** A post its site marks as shown to some people only, read with the sign-in for someone else. */
function restrictedPostError(site: SiteAccount, url: string): FlowUserError {
  const label = SITE_ACCOUNT_LABELS[site];
  return new FlowUserError(
    'flow.error.othersRestricted',
    { site: label },
    `${label} shows this post to some people only; it is read only for an admin in a private chat with the bot: ${url}`,
  );
}

/**
 * What someone else gets of a post the owner's sign-in read for them (`readForOthers`), the one
 * decision: a post its site marks as shown to some people only (`XPost.audience` `restricted` —
 * friends, a private account, close friends, a protected or subscribers-only post, or a shared or
 * quoted part that is) is refused whole, nothing of it given; any other — marked public, or with no marker Yobi
 * reads — is theirs as anyone sees it (`publicThread`).
 */
export function threadForOthers(thread: XThread, site: SiteAccount, url: string): XThread {
  if (thread.focal.audience === 'restricted') throw restrictedPostError(site, url);
  return publicThread(thread);
}

/**
 * A post as anyone would see it, without what is there only for the owner's eyes: a reply whose
 * own author the site marks not public (an X protected account the owner follows) is dropped; one
 * marked public or not marked at all stays, as does a comment its reader marks nothing on
 * (Facebook, Instagram), seen by whoever sees the post. The readers take nothing else tied to the
 * viewer (no "liked by" names, no friend badges, no "followed by"); a new field that would must
 * be left out here.
 */
function publicThread(thread: XThread): XThread {
  const replies = thread.replies.filter((reply) => reply.audience !== 'restricted');
  return { ...thread, replies };
}
