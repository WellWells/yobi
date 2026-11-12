import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import { useAppStore } from '../../../store/appStore';
import type { PromptLength, PromptPreferences, PromptTone } from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { withLanguagePlaceholder } from '../../../../../shared/promptLanguage';

export function buildCombinedPrompt(
  prefs: PromptPreferences,
  t: (key: string) => string,
): string {
  const parts: string[] = [];
  if ((prefs.nickname ?? '').trim()) {
    parts.push(fillTemplate(t('settings.prompt.built.nickname'), { name: prefs.nickname!.trim() }));
  }
  if (prefs.tone !== 'default') {
    parts.push(t(`settings.prompt.built.tone.${prefs.tone}`));
  }
  if (prefs.length !== 'auto') {
    parts.push(t(`settings.prompt.built.length.${prefs.length}`));
  }
  if (prefs.customInstructions.trim()) {
    parts.push(`${t('settings.prompt.built.extra')}${prefs.customInstructions.trim()}`);
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * The instruction preview shown in Settings, in the user's words. The model-facing block (built in
 * main) starts with `System Instruction:` and names the locale by code; the preview drops the prefix
 * and names the language the way the language picker does.
 */
export function buildPromptPreview(
  prefs: PromptPreferences,
  syncLanguage: boolean,
  languageName: string,
  t: (key: string) => string,
): string {
  const languageLine = syncLanguage
    ? fillTemplate(t('settings.prompt.preview.language'), { language: languageName })
    : '';
  return [buildCombinedPrompt(prefs, t), languageLine].filter(Boolean).join('\n');
}

/**
 * What the YouTube prompt field stores: '' keeps the built-in default, which follows the app
 * language. A copy of the old built-in text that spelled out a language counts as the default too.
 */
export function youtubePromptToStore(text: string, builtIn: string): string {
  const trimmed = text.trim();
  return !trimmed || withLanguagePlaceholder(trimmed) === withLanguagePlaceholder(builtIn.trim()) ? '' : text;
}

const DEFAULT_PREFS: PromptPreferences = {
  tone: 'default',
  length: 'auto',
  customInstructions: '',
};

export function usePromptPrefs() {
  const t = useI18nStore((s) => s.t);
  const [promptPrefs, setPromptPrefs] = useState<PromptPreferences>(DEFAULT_PREFS);
  const [syncSystemLanguageToModel, setSyncSystemLanguageToModel] = useState(false);
  const [youtubePrompt, setYoutubePrompt] = useState('');
  const [youtubeSaveFailed, setYoutubeSaveFailed] = useState(false);
  const youtubeSaveRevision = useRef(0);
  const youtubePending = useRef(Promise.resolve(true));
  // null while the field is not being edited, so the built-in text tracks a language switch.
  const [youtubeDraft, setYoutubeDraft] = useState<string | null>(null);
  const youtubeDefault = t('youtube.prompt.default');
  const youtubePromptText = youtubeDraft ?? (youtubePrompt || youtubeDefault);
  const youtubeCustomized = youtubePromptToStore(youtubePromptText, youtubeDefault) !== '';

  useEffect(() => {
    void settingsApi.getPromptPreferences().then(setPromptPrefs);
    void settingsApi.getSyncSystemLanguageToModel().then(setSyncSystemLanguageToModel);
    void settingsApi.getYoutubePrompt().then((value) => {
      if (youtubeSaveRevision.current === 0) setYoutubePrompt(value);
    });
  }, []);

  const savePromptPrefs = useCallback(async (prefs: PromptPreferences) => {
    useAppStore.getState().setUserNickname(prefs.nickname ?? '');
    await settingsApi.updatePromptPreferences(prefs);
  }, []);

  const prefsRef = useRef(promptPrefs);
  useEffect(() => { prefsRef.current = promptPrefs; }, [promptPrefs]);

  /**
   * A tidied draft of the custom instructions, saved only when the field still holds the text the
   * draft was made from. The field takes the text once main has saved it, so the preview below and
   * the saved preferences say the same; a failed save leaves both as they were.
   */
  const commitCustomInstructions = useCallback(async (text: string, base: string): Promise<boolean | 'changed'> => {
    const current = prefsRef.current;
    if (current.customInstructions !== base) return 'changed';
    const next = { ...current, customInstructions: text };
    try {
      if (!await settingsApi.updatePromptPreferences(next)) return false;
    } catch {
      return false;
    }
    prefsRef.current = next;
    setPromptPrefs(next);
    return true;
  }, []);

  const commitYoutubePrompt = useCallback((text: string): Promise<boolean> => {
    const stored = youtubePromptToStore(text, youtubeDefault);
    const submittedDraft = youtubeDraft;
    const version = ++youtubeSaveRevision.current;
    setYoutubeSaveFailed(false);
    youtubePending.current = youtubePending.current.then(async () => {
      try {
        const saved = await settingsApi.updateYoutubePrompt(stored);
        if (!saved) {
          if (version === youtubeSaveRevision.current) setYoutubeSaveFailed(true);
          return false;
        }
        if (version === youtubeSaveRevision.current) {
          setYoutubePrompt(stored);
          setYoutubeDraft((draft) => draft === submittedDraft ? null : draft);
        }
        return true;
      } catch {
        if (version === youtubeSaveRevision.current) setYoutubeSaveFailed(true);
        return false;
      }
    });
    return youtubePending.current;
  }, [youtubeDefault, youtubeDraft]);

  const handleToggleSyncSystemLanguageToModel = useCallback(async () => {
    const next = !syncSystemLanguageToModel;
    await settingsApi.updateSyncSystemLanguageToModel(next);
    setSyncSystemLanguageToModel(next);
  }, [syncSystemLanguageToModel]);

  const handleToneChange = useCallback((tone: string) => {
    const next = { ...promptPrefs, tone: tone as PromptTone };
    setPromptPrefs(next);
    void savePromptPrefs(next);
  }, [promptPrefs, savePromptPrefs]);

  const handleLengthChange = useCallback((length: string) => {
    const next = { ...promptPrefs, length: length as PromptLength };
    setPromptPrefs(next);
    void savePromptPrefs(next);
  }, [promptPrefs, savePromptPrefs]);

  const applyPromptReset = useCallback((prefs: PromptPreferences, syncLang: boolean, ytPrompt: string) => {
    youtubeSaveRevision.current++;
    setYoutubeSaveFailed(false);
    setPromptPrefs(prefs);
    setSyncSystemLanguageToModel(syncLang);
    setYoutubePrompt(ytPrompt);
    setYoutubeDraft(null);
    useAppStore.getState().setUserNickname(prefs.nickname ?? '');
  }, []);

  return {
    promptPrefs,
    setPromptPrefs,
    syncSystemLanguageToModel,
    youtubePromptText,
    youtubeSaveFailed,
    youtubeCustomized,
    setYoutubeDraft,
    commitYoutubePrompt,
    savePromptPrefs,
    commitCustomInstructions,
    handleToggleSyncSystemLanguageToModel,
    handleToneChange,
    handleLengthChange,
    applyPromptReset,
  };
}
