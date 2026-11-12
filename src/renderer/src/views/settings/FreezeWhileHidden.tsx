import React from 'react';

interface FreezeWhileHiddenProps {
  /** On screen: Settings is open on this page and, for a category, the nav or the search shows it. */
  shown: boolean;
  /** A search keystroke whose results are still being worked out: the pass that follows draws them. */
  pending?: boolean;
  children: React.ReactNode;
}

/**
 * Whether a frozen part may keep what it drew last. Hidden, it may: nobody sees it, and it draws
 * afresh the moment it shows. Shown, it draws again, except in a search keystroke's own pass: the
 * pass with that keystroke's results always follows, and the field stays quick. React compares
 * with the props of the last time it drew, not the last ones passed, so only `next` decides.
 */
export function freezeUnchanged(_prev: FreezeWhileHiddenProps, next: FreezeWhileHiddenProps): boolean {
  return !next.shown || Boolean(next.pending);
}

/**
 * Settings keeps every category mounted, so the sections keep their state and their listeners,
 * but drawing all of them again on every change of Settings (a keystroke in its search, opening
 * it) cost some 12,000 components when one page is on screen. A frozen part still follows its own
 * state and stores; only the redraws its parent passes down wait until it shows.
 */
export const FreezeWhileHidden = React.memo(
  ({ children }: FreezeWhileHiddenProps) => <>{children}</>,
  freezeUnchanged,
);
FreezeWhileHidden.displayName = 'FreezeWhileHidden';
