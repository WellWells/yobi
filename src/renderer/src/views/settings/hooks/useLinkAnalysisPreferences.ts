import { useCallback, useEffect, useRef, useState } from 'react';
import type { LinkAnalysisPreferences } from '../../../../../shared/types';
import { defaultMapReviewsPrompt, MAP_REVIEW_FOCUS_PROMPTS } from '../../../../../shared/mapReviewsPrompt';
import { withLanguagePlaceholder } from '../../../../../shared/promptLanguage';
import { settingsApi } from '../../../api/electronApi';

const EMPTY_PREFERENCES: LinkAnalysisPreferences = {
  mapsTargetUrl: '', articleTargetUrl: '', mapsPrompt: '',
};

// The same in every app language, so it is built once.
const MAPS_DEFAULT = defaultMapReviewsPrompt();

/**
 * '' for an empty field or the untouched built-in report, which then keeps following the app
 * language; a copy of the old built-in report that spelled out a language counts as untouched too.
 */
export function mapsPromptToStore(text: string): string {
  const trimmed = text.trim();
  return !trimmed || withLanguagePlaceholder(trimmed) === MAPS_DEFAULT.trim() ? '' : text;
}

export type MapsPreset = 'default' | keyof typeof MAP_REVIEW_FOCUS_PROMPTS;

/** The template the text is, unchanged; null for anything the user edited. */
export function mapsPresetOf(text: string): MapsPreset | null {
  if (!mapsPromptToStore(text)) return 'default';
  const trimmed = text.trim();
  const preset = (Object.keys(MAP_REVIEW_FOCUS_PROMPTS) as (keyof typeof MAP_REVIEW_FOCUS_PROMPTS)[])
    .find((key) => MAP_REVIEW_FOCUS_PROMPTS[key].trim() === trimmed);
  return preset ?? null;
}

export function mapsPresetText(preset: MapsPreset): string {
  return preset === 'default' ? '' : MAP_REVIEW_FOCUS_PROMPTS[preset];
}

export function useLinkAnalysisPreferences() {
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [mapsDraft, setMapsDraft] = useState<string | null>(null);
  const latest = useRef(preferences);
  const confirmed = useRef(preferences);
  const revision = useRef(0);
  const pending = useRef(Promise.resolve(true));
  const mapsPromptText = mapsDraft ?? (preferences.mapsPrompt || MAPS_DEFAULT);

  useEffect(() => {
    let active = true;
    void settingsApi.getLinkAnalysisPreferences().then((value) => {
      if (!active || revision.current > 0) return;
      latest.current = value;
      confirmed.current = value;
      setPreferences(value);
      setReady(true);
    }, () => { if (active) setSaveFailed(true); });
    return () => { active = false; };
  }, []);

  const update = useCallback((patch: Partial<LinkAnalysisPreferences>): Promise<boolean> => {
    const next = { ...latest.current, ...patch };
    const version = ++revision.current;
    latest.current = next;
    setPreferences(next);
    setBusy(true);
    setSaveFailed(false);
    pending.current = pending.current.then(async () => {
      try {
        const saved = await settingsApi.updateLinkAnalysisPreferences(next);
        confirmed.current = saved;
        if (revision.current === version) {
          latest.current = saved;
          setPreferences(saved);
        }
        return true;
      } catch {
        if (revision.current === version) {
          latest.current = confirmed.current;
          setPreferences(confirmed.current);
          setSaveFailed(true);
        }
        return false;
      } finally {
        if (revision.current === version) setBusy(false);
      }
    });
    return pending.current;
  }, []);

  const commitMapsPrompt = useCallback((text: string): Promise<boolean> => {
    setMapsDraft(null);
    const mapsPrompt = mapsPromptToStore(text);
    if (mapsPrompt === latest.current.mapsPrompt) return pending.current.then(() => confirmed.current.mapsPrompt === mapsPrompt);
    return update({ mapsPrompt });
  }, [update]);

  const applyReset = useCallback((value: LinkAnalysisPreferences) => {
    revision.current++;
    latest.current = value;
    confirmed.current = value;
    setPreferences(value);
    setMapsDraft(null);
    setSaveFailed(false);
    setBusy(false);
    setReady(true);
  }, []);

  return {
    preferences, ready, busy, saveFailed, update, applyReset,
    mapsPromptText, setMapsDraft, commitMapsPrompt,
    mapsCustomized: mapsPromptToStore(mapsPromptText) !== '',
  };
}
