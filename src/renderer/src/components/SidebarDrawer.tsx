import React, { useEffect } from 'react';
import { Box, Overlay } from '@mantine/core';
import { PanelLeftOpen } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Z_SIDEBAR_DRAWER } from '../config/zLayers';
import { useNarrowWindow } from '../hooks/useNarrowWindow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useSidebarDrawerStore } from '../store/sidebarDrawerStore';
import { BACKDROP_OPACITY } from '../theme/mantineTheme';
import { ToolbarIconButton } from './PanelToolbar';
import styles from './SidebarDrawer.module.css';

/** Whether a dialog is on screen: the drawer is under it and its Escape is the dialog's. */
function dialogOnScreen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((dialog) => dialog.checkVisibility());
}

interface SidebarDrawerProps {
  /** The view's selection (the open conversation, the open flow): picking another closes the drawer. */
  selection: string | null;
  children: React.ReactNode;
}

/**
 * A view's sidebar. Beside the view while the window is wide enough (the wrapper is not drawn:
 * `display: contents`); in a narrow window it is out of the way and opens over the view's left
 * edge, the view dimmed behind it, as ChatGPT's, Gemini's and Perplexity's do on a narrow window.
 * The same element either way, so the sidebar never remounts as the window crosses the width:
 * its scroll place, a title being edited and its menus stay.
 *
 * Closes on the backdrop, Escape, a pick (another conversation or flow), leaving for Settings and
 * the window widening. Switching views from inside it keeps it out: the other list is in front.
 */
export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({ selection, children }) => {
  const narrow = useNarrowWindow();
  const { open, close } = useSidebarDrawerStore(useShallow((s) => ({ open: s.open, close: s.close })));
  const listView = useAppStore((s) => s.currentView === 'chat' || s.currentView === 'flow');
  const out = narrow && open;

  useEffect(() => {
    if (!narrow || !listView) close();
  }, [narrow, listView, close]);
  useEffect(() => {
    close();
  }, [selection, close]);
  useEffect(() => {
    if (!out) return undefined;
    // Bubble phase, after the sidebar's own fields and menus had their say (a rename's Escape
    // cancels the rename, not the drawer).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || dialogOnScreen()) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [out, close]);

  return (
    <>
      <Box
        data-sidebar-drawer={narrow ? (open ? 'open' : 'closed') : undefined}
        className={out ? styles.drawer : undefined}
        style={narrow
          ? { display: open ? 'flex' : 'none', position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: Z_SIDEBAR_DRAWER }
          : { display: 'contents' }}
      >
        {children}
      </Box>
      {out && (
        <Overlay
          backgroundOpacity={BACKDROP_OPACITY}
          zIndex={Z_SIDEBAR_DRAWER - 1}
          onClick={close}
          data-sidebar-drawer-backdrop=""
        />
      )}
    </>
  );
};

interface SidebarDrawerButtonProps {
  /** The name with the view's shortcut for it, if it has one. */
  label?: string;
}

/** The way to the sidebar in a narrow window: at the start of the view's top row; nothing otherwise. */
export const SidebarDrawerButton: React.FC<SidebarDrawerButtonProps> = ({ label }) => {
  const narrow = useNarrowWindow();
  const t = useI18nStore((s) => s.t);
  const setOpen = useSidebarDrawerStore((s) => s.setOpen);
  if (!narrow) return null;
  return <ToolbarIconButton icon={PanelLeftOpen} label={label ?? t('sidebar.expand')} onClick={() => setOpen(true)} />;
};
