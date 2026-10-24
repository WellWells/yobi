import { useCallback, useMemo, useState } from 'react';

export interface ClickModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  orderedIds: string[];
}

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
  setAnchor: (id: string | null) => void;
  selectClick: (id: string, mods: ClickModifiers) => 'open' | 'multi';
  /** Renames ids in place (an item that moved), keeping the selection and the anchor. */
  rename: (to: (id: string) => string) => void;
}

export interface SelectClickState {
  selectMode: boolean;
  selectedIds: Set<string>;
  anchorId: string | null;
}

/**
 * One row click. Once selection mode is on, a plain click toggles the row like its
 * checkbox does — leaving the mode is the action bar's Cancel, never a missed checkbox.
 */
export function resolveSelectClick(
  current: SelectClickState,
  id: string,
  mods: ClickModifiers,
): { state: SelectClickState; result: 'open' | 'multi' } {
  const { ctrlKey, shiftKey, orderedIds } = mods;
  const { selectMode, selectedIds, anchorId } = current;

  if (shiftKey && anchorId) {
    const from = orderedIds.indexOf(anchorId);
    const to = orderedIds.indexOf(id);
    if (from >= 0 && to >= 0) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return {
        state: { selectMode: true, selectedIds: new Set(orderedIds.slice(lo, hi + 1)), anchorId },
        result: 'multi',
      };
    }
  }

  if (ctrlKey || shiftKey || selectMode) {
    const seedable = anchorId !== null && orderedIds.includes(anchorId);
    const base = selectMode ? new Set(selectedIds) : new Set(seedable ? [anchorId] : []);
    if (base.has(id)) base.delete(id);
    else base.add(id);
    return { state: { selectMode: true, selectedIds: base, anchorId: id }, result: 'multi' };
  }

  return { state: { selectMode: false, selectedIds: new Set(), anchorId: id }, result: 'open' };
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
    const next = resolveSelectClick({ selectMode, selectedIds, anchorId }, id, mods);
    setSelectMode(next.state.selectMode);
    setSelectedIds(next.state.selectedIds);
    setAnchorId(next.state.anchorId);
    return next.result;
  }, [anchorId, selectMode, selectedIds]);

  const rename = useCallback((to: (id: string) => string) => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].map(to));
      return [...prev].every((id) => next.has(id)) ? prev : next;
    });
    setAnchorId((prev) => (prev === null ? prev : to(prev)));
  }, []);

  return useMemo(
    () => ({
      selectMode, selectedIds, count: selectedIds.size,
      enter, exit, toggle, isSelected, toggleAll, allSelected, setAnchor, selectClick, rename,
    }),
    [selectMode, selectedIds, enter, exit, toggle, isSelected, toggleAll, allSelected, setAnchor, selectClick, rename],
  );
}
