import { create } from 'zustand';
import { activeCombos, collisionCombos, matchesCombo, shortcutById, SHORTCUTS } from '../../../shared/shortcuts';
import type { KeyboardEventLike, ShortcutId, ShortcutOverride } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';
import type { View } from './appStore';

export type ShortcutHandler = (event: KeyboardEvent, matchedCombo: string) => void;

interface HandlerEntry {
  view: View | 'any';
  fn: ShortcutHandler;
}

interface ShortcutState {
  overrides: Record<string, ShortcutOverride>;
  handlers: Record<string, HandlerEntry[]>;
  setOverrides: (next: Record<string, ShortcutOverride>) => void;
  setOverride: (id: ShortcutId, override: ShortcutOverride | undefined) => void;
  registerHandler: (id: ShortcutId, view: View | 'any', fn: ShortcutHandler) => () => void;
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  overrides: {},
  handlers: {},

  setOverrides: (next) => set({ overrides: next }),

  setOverride: (id, override) => set((state) => {
    const overrides = { ...state.overrides };
    if (override) overrides[id] = override;
    else delete overrides[id];
    return { overrides };
  }),

  registerHandler: (id, view, fn) => {
    const entry: HandlerEntry = { view, fn };
    set((state) => ({
      handlers: { ...state.handlers, [id]: [...(state.handlers[id] ?? []), entry] },
    }));
    return () => {
      const list = get().handlers[id];
      if (!list) return;
      const next = list.filter((candidate) => candidate !== entry);
      set((state) => ({ handlers: { ...state.handlers, [id]: next } }));
    };
  },
}));

export function resolvedCombos(id: ShortcutId): string[] {
  return activeCombos(shortcutById(id), isMac, useShortcutStore.getState().overrides[id]);
}

export function resolvedCombo(id: ShortcutId): string {
  return resolvedCombos(id)[0] ?? '';
}

export function isShortcutOff(id: ShortcutId): boolean {
  return useShortcutStore.getState().overrides[id]?.off === true;
}

export function matchesShortcut(event: KeyboardEventLike, id: ShortcutId): boolean {
  return resolvedCombos(id).some((combo) => matchesCombo(event, combo, [], { isMac }));
}

export function useResolvedCombo(id: ShortcutId): string {
  const override = useShortcutStore((s) => s.overrides[id]);
  return activeCombos(shortcutById(id), isMac, override)[0] ?? '';
}

export function useResolvedCombos(id: ShortcutId): string[] {
  const override = useShortcutStore((s) => s.overrides[id]);
  return activeCombos(shortcutById(id), isMac, override);
}

export function allResolvedBindings(): Record<string, string[]> {
  const { overrides } = useShortcutStore.getState();
  const bindings: Record<string, string[]> = {};
  for (const def of SHORTCUTS) {
    bindings[def.id] = collisionCombos(def, isMac, overrides[def.id]);
  }
  return bindings;
}
