import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { settingsApi } from '../../../api/electronApi';
import { visibleModels } from '../../../config/models';
import { selectHiddenSources, useAppStore } from '../../../store/appStore';
import { duckaiModelIdFromUrl } from '../../../../../shared/types';
import type { HiddenSources, Provider } from '../../../../../shared/types';

export interface HiddenSourcesController {
  hidden: HiddenSources;
  busy: boolean;
  toggleProvider: (provider: Provider) => void;
  toggleDuckaiModel: (modelId: string) => void;
  toggleByok: (instanceId: string) => void;
  toggleByokGroup: (groupId: string) => void;
  duckaiVisibleCount: number;
  duckaiTotalCount: number;
  canApply: (next: HiddenSources) => boolean;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

export function useHiddenSources(): HiddenSourcesController {
  const hidden = useAppStore(useShallow(selectHiddenSources));
  const duckaiModels = useAppStore((s) => s.duckaiModels);
  const setHiddenSources = useAppStore((s) => s.setHiddenSources);
  const [busy, setBusy] = useState(false);

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

  const duckaiHiddenCount = duckaiModels.filter((model) => {
    const id = duckaiModelIdFromUrl(model.url);
    return id !== null && hidden.duckaiModelIds.includes(id);
  }).length;

  return {
    hidden,
    busy,
    toggleProvider,
    toggleDuckaiModel,
    toggleByok,
    toggleByokGroup,
    duckaiVisibleCount: duckaiModels.length - duckaiHiddenCount,
    duckaiTotalCount: duckaiModels.length,
    canApply,
  };
}
