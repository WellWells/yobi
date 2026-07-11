import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { settingsApi } from '../../../api/electronApi';
import { visibleModels } from '../../../config/models';
import { selectHiddenSources, useAppStore } from '../../../store/appStore';
import { duckaiModelIdFromUrl } from '../../../../../shared/types';
import type { HiddenSources, Provider } from '../../../../../shared/types';

/** Tri-state, mirroring Mantine's Checkbox: some children on, some off. */
export type DuckaiState = 'all' | 'none' | 'partial';

export interface HiddenSourcesController {
  hidden: HiddenSources;
  busy: boolean;
  toggleProvider: (provider: Provider) => void;
  toggleDuckaiModel: (modelId: string) => void;
  toggleByok: (instanceId: string) => void;
  toggleByokGroup: (groupId: string) => void;
  /** Clicking the Duck AI parent: show everything, or hide the provider outright. */
  setDuckaiAll: (visible: boolean) => void;
  duckaiState: DuckaiState;
  /** False when applying `next` would leave the model pickers with nothing in them. */
  canApply: (next: HiddenSources) => boolean;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

// Owns the hidden-source toggles for the Model Sources settings section. Writes go to
// the store first so every picker updates on the same tick, then persist.
export function useHiddenSources(): HiddenSourcesController {
  const hidden = useAppStore(useShallow(selectHiddenSources));
  const duckaiModels = useAppStore((s) => s.duckaiModels);
  const setHiddenSources = useAppStore((s) => s.setHiddenSources);
  const [busy, setBusy] = useState(false);

  // An empty picker has no fallback anywhere — chat, flows and bots all resolve a
  // model through it — so the last visible source can never be switched off.
  const canApply = useCallback((next: HiddenSources) => {
    return visibleModels(useAppStore.getState(), next).length > 0;
  }, []);

  const commit = useCallback(async (next: HiddenSources) => {
    if (!canApply(next)) return;
    setBusy(true);
    setHiddenSources(next);
    try {
      await settingsApi.updateHiddenSources(next);
    } finally {
      setBusy(false);
    }
  }, [canApply, setHiddenSources]);

  // Read the current sets at click time, not from the render closure: this section
  // renders several rows, and two quick toggles must not clobber each other.
  const apply = useCallback((patch: (current: HiddenSources) => HiddenSources) => {
    void commit(patch(selectHiddenSources(useAppStore.getState())));
  }, [commit]);

  const toggleProvider = useCallback((provider: Provider) => {
    apply((current) => ({
      ...current,
      providers: current.providers.includes(provider)
        ? current.providers.filter((p) => p !== provider)
        : [...current.providers, provider],
    }));
  }, [apply]);

  const toggleDuckaiModel = useCallback((modelId: string) => {
    apply((current) => ({ ...current, duckaiModelIds: toggleId(current.duckaiModelIds, modelId) }));
  }, [apply]);

  const toggleByok = useCallback((instanceId: string) => {
    apply((current) => ({ ...current, byokIds: toggleId(current.byokIds, instanceId) }));
  }, [apply]);

  const toggleByokGroup = useCallback((groupId: string) => {
    apply((current) => ({ ...current, byokGroupIds: toggleId(current.byokGroupIds, groupId) }));
  }, [apply]);

  // Showing everything also clears the per-model hides, so the parent checkbox never
  // lands on "checked" while some children are still off.
  const setDuckaiAll = useCallback((visible: boolean) => {
    apply((current) => (visible
      ? { ...current, providers: current.providers.filter((p) => p !== 'duckai'), duckaiModelIds: [] }
      : { ...current, providers: [...current.providers, 'duckai'] }));
  }, [apply]);

  // Count against the models that actually exist right now: a stale id left over from
  // a duck.ai model that no longer ships must not force the parent to read "partial".
  const hiddenCount = duckaiModels.filter((model) => {
    const id = duckaiModelIdFromUrl(model.url);
    return id !== null && hidden.duckaiModelIds.includes(id);
  }).length;
  const duckaiState: DuckaiState = (
    hidden.providers.includes('duckai') || (duckaiModels.length > 0 && hiddenCount === duckaiModels.length)
      ? 'none'
      : hiddenCount > 0 ? 'partial' : 'all'
  );

  return {
    hidden,
    busy,
    toggleProvider,
    toggleDuckaiModel,
    toggleByok,
    toggleByokGroup,
    setDuckaiAll,
    duckaiState,
    canApply,
  };
}
