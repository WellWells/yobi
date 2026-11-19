import React from 'react';
import { Box } from '@mantine/core';
import { isMainView, useAppStore } from '../../store/appStore';

interface FreezeProps {
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
export function freezeUnchanged(_prev: FreezeProps, next: FreezeProps): boolean {
  return !next.shown || Boolean(next.pending);
}

const Frozen = React.memo(({ children }: FreezeProps) => <>{children}</>, freezeUnchanged);
Frozen.displayName = 'Frozen';

/**
 * A part of a Settings page the search shows or hides. Hidden, it keeps what it drew last, as a
 * hidden page does: a search draws every page it matches, and more than half of what those pages
 * held sat in parts the same search hid (1,864 of 3,280 elements for 「通」), drawn for nothing.
 * Its margins fall through the wrapper, so a card inside one sits as it did.
 */
export function SearchSection({ shown, children }: { shown: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <Box display={shown ? 'block' : 'none'}>
      <Frozen shown={shown}>{children}</Frozen>
    </Box>
  );
}

const PageOnScreen = React.createContext(false);

/**
 * Whether the Settings page this sits in is on screen. A page that reads data of its own reads it
 * only then: its own state still redraws it while frozen, so reading on every opening of Settings
 * redrew a hidden page in full.
 */
export function usePageOnScreen(): boolean {
  return React.useContext(PageOnScreen);
}

/**
 * Settings keeps every category mounted, so the sections keep their state and their listeners,
 * but drawing all of them again on every change of Settings (a keystroke in its search, opening
 * it) cost some 12,000 components when one page is on screen. A frozen part still follows its own
 * state and stores; only the redraws its parent passes down wait until it shows.
 *
 * Whether the dialog is open is read here, not passed down: opening or closing Settings then
 * redraws only these wrappers, never SettingsView. A wrapper that shows hands on the very
 * children it was last given, so the page draws again only when its parent changed it while the
 * dialog was shut; otherwise React finds the same elements and keeps what is drawn.
 */
export function FreezeWhileHidden({ shown, pending, children }: FreezeProps): React.ReactElement {
  const open = useAppStore((s) => !isMainView(s.currentView));
  return (
    <PageOnScreen.Provider value={open && shown}>
      <Frozen shown={open && shown} pending={pending}>{children}</Frozen>
    </PageOnScreen.Provider>
  );
}
