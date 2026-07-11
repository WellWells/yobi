import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MODELS, buildProviderSections, providerExtraModels } from '../config/models';
import type { ModelOption, ProviderSection } from '../config/models';
import type { HiddenSources } from '../../../shared/types';
import { selectHiddenSources, useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';

export interface ProviderModels {
  sections: ProviderSection[];
  /** Everything the user configured on top of MODELS, in picker order. Unfiltered. */
  extraModels: ModelOption[];
  /** Every selectable model, in picker order. Unfiltered. */
  allModels: ModelOption[];
  hidden: HiddenSources;
  /** Label suffix for an entry kept visible only because it is the current value. */
  hiddenSuffix: string;
}

// Reads the dynamic provider lists once, in picker order, for every model picker in
// the app. Call this instead of pulling duckaiModels/byokModels/byokGroupModels out
// of the store by hand — a picker that assembles its own list is how key groups went
// missing from the AgentFlow LLM step.
//
// `keepVisibleUrl` is the caller's currently stored value: it stays listed even when
// hidden, so a picker never blanks out its own selection.
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
    // extraModels/allModels stay UNFILTERED: they back findModelOption() lookups in
    // WelcomeScreen and useRewriteTask. Filtering them would make a hidden but still
    // selected model resolve to the Gemini fallback — the UI would name one provider
    // while the send goes to another. Only `sections` is filtered.
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
