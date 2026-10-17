/*
 * Who a site shows a post to, as the post's own data marks it. A post anyone may see gives nothing
 * of the owner's circle away, even when only the owner's sign-in could fetch it; only what can be
 * told to be for some people only is kept from others. Each site's reader reads its own marker
 * (Facebook's audience icon, Instagram's private account, X's protected account); what the run
 * does with it is decided once, in `threadForOthers` (`readAccess.ts`).
 */

/**
 * - `public`: the site marks it as shown to everyone.
 * - `restricted`: marked as shown to some people only (friends, followers, a group, close friends).
 * - `unknown`: no marker the reader trusts; treated as public wherever it matters.
 */
export type PostAudience = 'public' | 'restricted' | 'unknown';

/**
 * One post's audience from each part that must be public for all of it to be — the post, and a
 * post it quotes or shares (whose text and media go out with it). Any part restricted makes it
 * restricted; any part unmarked makes it unknown; nothing marked at all is unknown.
 */
export function combineAudience(parts: readonly PostAudience[]): PostAudience {
  if (parts.length === 0) return 'unknown';
  if (parts.includes('restricted')) return 'restricted';
  return parts.every((part) => part === 'public') ? 'public' : 'unknown';
}

/** A site's yes/no marker: `true` public, `false` not, anything else (absent, malformed) unknown. */
export function audienceFromFlag(isPublic: unknown): PostAudience {
  if (isPublic === true) return 'public';
  return isPublic === false ? 'restricted' : 'unknown';
}
