import { create } from 'zustand';
import type { KnowledgeBase } from '../../../shared/knowledgeBase';
import type { KnowledgeStatus } from '../../../shared/knowledgeStatus';

/**
 * The knowledge bases and their index status, shared by Settings and the chat composer (the
 * composer offers the bases next to the connectors; Settings shows the indexing progress).
 */
interface KnowledgeState {
  bases: KnowledgeBase[];
  statuses: Record<string, KnowledgeStatus>;
  setBases: (bases: KnowledgeBase[]) => void;
  setStatuses: (statuses: KnowledgeStatus[]) => void;
  applyStatus: (status: KnowledgeStatus) => void;
}

/** Same fields, same values: every field of either is a primitive. */
export function sameFields<T extends object>(a: T | undefined, b: T): boolean {
  if (!a) return false;
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * A status or base list equal to the one held keeps the held one, so nothing that reads it draws
 * again: main reports a base's status after every file it reads, and again when a sync finds
 * nothing changed.
 */
export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  bases: [],
  statuses: {},
  setBases: (bases) => set((state) => (
    bases.length === state.bases.length && bases.every((base, i) => sameBase(state.bases[i], base)) ? state : { bases }
  )),
  setStatuses: (list) => set((state) => {
    const statuses = Object.fromEntries(list.map((status) => {
      const held = state.statuses[status.id];
      return [status.id, held && sameFields(held, status) ? held : status];
    }));
    const unchanged = list.length === Object.keys(state.statuses).length
      && list.every((status) => statuses[status.id] === state.statuses[status.id]);
    return unchanged ? state : { statuses };
  }),
  applyStatus: (status) => set((state) => (
    sameFields(state.statuses[status.id], status) ? state : { statuses: { ...state.statuses, [status.id]: status } }
  )),
}));

function sameBase(a: KnowledgeBase | undefined, b: KnowledgeBase): boolean {
  return Boolean(a) && a!.id === b.id && a!.name === b.name && a!.folder === b.folder
    && a!.aliases.length === b.aliases.length && a!.aliases.every((alias, i) => alias === b.aliases[i]);
}
