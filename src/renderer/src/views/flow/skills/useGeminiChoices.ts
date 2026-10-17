import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { byokApi } from '../../../api/electronApi';
import { selectHiddenSources, useAppStore } from '../../../store/appStore';
import { geminiFallbackChoices } from './youtubeFallback';
import type { FallbackChoice } from './youtubeFallback';
import type { ByokSettingsSnapshot } from '../../../../../shared/types';

/**
 * The Gemini API groups and keys a step can pick to watch a video; `loaded` turns true once the
 * BYOK settings are read, so "no key" is not claimed before then.
 */
export function useGeminiChoices(selected: string): { groups: FallbackChoice[]; keys: FallbackChoice[]; loaded: boolean } {
  const hidden = useAppStore(useShallow(selectHiddenSources));
  // Both lists are replaced whenever BYOK settings are saved, so they double as a change signal.
  const byokModels = useAppStore((s) => s.byokModels);
  const byokGroupModels = useAppStore((s) => s.byokGroupModels);
  const [snapshot, setSnapshot] = useState<ByokSettingsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void byokApi.getSettings().then((next) => { if (!cancelled) setSnapshot(next); });
    return () => { cancelled = true; };
  }, [byokModels, byokGroupModels]);

  if (!snapshot) return { groups: [], keys: [], loaded: false };
  return { ...geminiFallbackChoices(snapshot, hidden, selected), loaded: true };
}
