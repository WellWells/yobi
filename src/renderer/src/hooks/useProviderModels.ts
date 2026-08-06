import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MODELS, buildProviderSections, providerExtraModels } from '../config/models';
import type { ModelOption, ProviderSection } from '../config/models';
import type { HiddenSources } from '../../../shared/types';
import { selectHiddenSources, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';

export interface ProviderModels {
  sections: ProviderSection[];
  extraModels: ModelOption[];
  allModels: ModelOption[];
  hidden: HiddenSources;
  hiddenSuffix: string;
}

export function useProviderModels(keepVisibleUrl?: string): ProviderModels {
  const extras = useAppStore(
    useShallow((s) => ({
      duckaiModels: s.duckaiModels,
      byokModels: s.byokModels,
      byokGroupModels: s.byokGroupModels,
    })),
  );
  const hidden = useAppStore(useShallow(selectHiddenSources));
  const t = useI18nStore((s) => s.t);

  return useMemo(() => {
    const sections = buildProviderSections(
      extras,
      { byok: t('settings.byok.title'), byokGroups: t('settings.byok.group.title') },
      { hidden, keepVisibleUrl },
    );
    const extraModels = providerExtraModels(extras);
    return {
      sections,
      extraModels,
      allModels: [...MODELS, ...extraModels],
      hidden,
      hiddenSuffix: t('settings.modelSources.hiddenSuffix'),
    };
  }, [extras, hidden, keepVisibleUrl, t]);
}
