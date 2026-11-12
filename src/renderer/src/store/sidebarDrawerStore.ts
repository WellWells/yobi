import { create } from 'zustand';

/*
 * Whether the sidebar is out as a drawer over a narrow window. One flag for the chat and the flow
 * sidebars: switching views from inside the drawer keeps the other view's list in front. Not kept
 * across restarts, and apart from the folded rail (`sidebarLayoutStore`), which is the user's
 * choice for a wide window and is left as it was.
 */

interface SidebarDrawerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  toggle: () => void;
}

export const useSidebarDrawerStore = create<SidebarDrawerState>((set, get) => ({
  open: false,
  setOpen: (open) => {
    if (get().open !== open) set({ open });
  },
  close: () => get().setOpen(false),
  toggle: () => get().setOpen(!get().open),
}));

export function closeSidebarDrawer(): void {
  useSidebarDrawerStore.getState().close();
}
