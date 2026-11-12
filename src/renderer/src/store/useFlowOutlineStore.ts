import { create } from 'zustand';

/** Where "show the outline" is kept: a view preference of this window, like the sidebar's fold. */
export const OUTLINE_OPEN_KEY = 'flow.outline.open';

function readOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(OUTLINE_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface FlowOutlineState {
  /** Beside the editor when it is wide enough. */
  open: boolean;
  /** The drawer, when the editor is too narrow to have it beside. */
  drawerOpen: boolean;
  /** The step being worked on, per flow; only in memory, never in the flow. */
  selected: Record<string, string | undefined>;
  /** Loops and conditions folded in the outline (not in the editor), per flow. */
  folded: Record<string, readonly string[] | undefined>;
  /** Loops and conditions folded in the editor (their steps hidden under the card), per flow. */
  editorFolded: Record<string, readonly string[] | undefined>;
  /** The steps the editor shows right now, first and last, for the outline's rail. */
  visible: { flowId: string; first: string; last: string } | null;
  /** Bumped to ask the outline's search box for focus (Ctrl+F). */
  focusSearch: number;
  setOpen: (open: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  select: (flowId: string, stepId: string | undefined) => void;
  toggleFold: (flowId: string, stepId: string) => void;
  unfold: (flowId: string, stepIds: readonly string[]) => void;
  toggleEditorFold: (flowId: string, stepId: string) => void;
  /** Opens the editor's folded blocks around a step a jump lands on. */
  unfoldEditor: (flowId: string, stepIds: readonly string[]) => void;
  setVisible: (visible: FlowOutlineState['visible']) => void;
  requestSearchFocus: () => void;
  /** Drops ids no longer in the flow (discard, version restore, an AI edit, a delete). */
  prune: (flowId: string, stepIds: ReadonlySet<string>) => void;
}

export const useFlowOutlineStore = create<FlowOutlineState>((set) => ({
  open: readOpen(),
  drawerOpen: false,
  selected: {},
  folded: {},
  editorFolded: {},
  visible: null,
  focusSearch: 0,
  setOpen: (open) => {
    try { globalThis.localStorage?.setItem(OUTLINE_OPEN_KEY, String(open)); } catch { /* not kept */ }
    set({ open });
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  select: (flowId, stepId) => set((state) => (
    state.selected[flowId] === stepId ? state : { selected: { ...state.selected, [flowId]: stepId } }
  )),
  toggleFold: (flowId, stepId) => set((state) => ({ folded: toggled(state.folded, flowId, stepId) })),
  unfold: (flowId, stepIds) => set((state) => {
    const next = without(state.folded, flowId, stepIds);
    return next === state.folded ? state : { folded: next };
  }),
  toggleEditorFold: (flowId, stepId) => set((state) => ({ editorFolded: toggled(state.editorFolded, flowId, stepId) })),
  unfoldEditor: (flowId, stepIds) => set((state) => {
    const next = without(state.editorFolded, flowId, stepIds);
    return next === state.editorFolded ? state : { editorFolded: next };
  }),
  setVisible: (visible) => set((state) => {
    const before = state.visible;
    if (before && visible && before.flowId === visible.flowId && before.first === visible.first && before.last === visible.last) return state;
    if (!before && !visible) return state;
    return { visible };
  }),
  requestSearchFocus: () => set((state) => ({ focusSearch: state.focusSearch + 1 })),
  prune: (flowId, stepIds) => set((state) => {
    const selected = state.selected[flowId];
    const keepSelection = !selected || stepIds.has(selected);
    const gone = (map: Record<string, readonly string[] | undefined>): string[] => (map[flowId] ?? []).filter((id) => !stepIds.has(id));
    const folded = without(state.folded, flowId, gone(state.folded));
    const editorFolded = without(state.editorFolded, flowId, gone(state.editorFolded));
    if (keepSelection && folded === state.folded && editorFolded === state.editorFolded) return state;
    return {
      selected: keepSelection ? state.selected : { ...state.selected, [flowId]: undefined },
      folded,
      editorFolded,
    };
  }),
}));

type FoldMap = Record<string, readonly string[] | undefined>;

function toggled(map: FoldMap, flowId: string, stepId: string): FoldMap {
  const current = map[flowId] ?? [];
  const next = current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId];
  return { ...map, [flowId]: next };
}

/** The same map when none of `stepIds` is folded, so a no-op does not redraw anything. */
function without(map: FoldMap, flowId: string, stepIds: readonly string[]): FoldMap {
  const current = map[flowId] ?? [];
  if (!stepIds.some((id) => current.includes(id))) return map;
  return { ...map, [flowId]: current.filter((id) => !stepIds.includes(id)) };
}
