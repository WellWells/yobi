import { useCallback, useMemo, useState } from 'react';

/** Mouse-click intent for {@link MultiSelect.selectClick}. `ctrlKey` should already
 * fold in `metaKey` (Cmd on macOS); `orderedIds` is the visible list order used to
 * resolve a Shift range. */
export interface ClickModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  orderedIds: string[];
}

/**
 * Generic multi-selection state for a togglable "selection mode" over a list of
 * string ids. Shared by the AgentFlow flow list and the chat output sidebar so
 * both bulk-delete UIs behave identically.
 */
export interface MultiSelect {
  selectMode: boolean;
  selectedIds: Set<string>;
  count: number;
  enter: () => void;
  exit: () => void;
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
  toggleAll: (ids: string[]) => void;
  allSelected: (ids: string[]) => boolean;
  /** Pivot for Shift-range selection — kept in sync with the single selection. */
  setAnchor: (id: string | null) => void;
  /** File-manager click handling: Ctrl toggles, Shift ranges, plain collapses.
   * Returns `'open'` when the caller should open/load the item (plain click). */
  selectClick: (id: string, mods: ClickModifiers) => 'open' | 'multi';
}

export function useMultiSelect(): MultiSelect {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const enter = useCallback(() => setSelectMode(true), []);

  const exit = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const toggleAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const everySelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return everySelected ? new Set() : new Set(ids);
    });
  }, []);

  const allSelected = useCallback(
    (ids: string[]) => ids.length > 0 && ids.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const setAnchor = useCallback((id: string | null) => setAnchorId(id), []);

  const selectClick = useCallback((id: string, mods: ClickModifiers): 'open' | 'multi' => {
    const { ctrlKey, shiftKey, orderedIds } = mods;

    // Shift+click → contiguous range between the anchor and the clicked item.
    // The anchor stays put so consecutive Shift-clicks re-range from the same pivot.
    if (shiftKey && anchorId) {
      const from = orderedIds.indexOf(anchorId);
      const to = orderedIds.indexOf(id);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        setSelectedIds(new Set(orderedIds.slice(lo, hi + 1)));
        setSelectMode(true);
        return 'multi';
      }
    }

    // Ctrl/Cmd+click (or Shift with no usable anchor) → toggle the item, seeding
    // from the current single selection (anchor) the first time we enter mode.
    if (ctrlKey || shiftKey) {
      setSelectedIds((prev) => {
        // Only seed the anchor when it's actually visible — otherwise a filtered-out
        // open item would be silently added to the selection (and bulk-deleted).
        const seedable = anchorId !== null && orderedIds.includes(anchorId);
        const base = selectMode ? new Set(prev) : new Set(seedable ? [anchorId] : []);
        if (base.has(id)) base.delete(id);
        else base.add(id);
        return base;
      });
      setSelectMode(true);
      setAnchorId(id);
      return 'multi';
    }

    // Plain click → collapse to a single selection; the caller opens the item.
    setSelectMode(false);
    setSelectedIds(new Set());
    setAnchorId(id);
    return 'open';
  }, [anchorId, selectMode]);

  return useMemo(
    () => ({
      selectMode, selectedIds, count: selectedIds.size,
      enter, exit, toggle, isSelected, toggleAll, allSelected, setAnchor, selectClick,
    }),
    [selectMode, selectedIds, enter, exit, toggle, isSelected, toggleAll, allSelected, setAnchor, selectClick],
  );
}
