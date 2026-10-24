import { useCallback, useEffect, useState } from 'react';
import { settingsApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import { useAppStore } from '../../../store/appStore';
import type { PromptLength, PromptPreferences, PromptTone } from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

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

/** What the YouTube prompt field stores: '' keeps the built-in default, which follows the app language. */
export function youtubePromptToStore(text: string, builtIn: string): string {
  const trimmed = text.trim();
  return !trimmed || trimmed === builtIn.trim() ? '' : text;
}

const DEFAULT_PREFS: PromptPreferences = {
  tone: 'default',
  length: 'auto',
  customInstructions: '',
};

export function usePromptPrefs() {
  const { t } = useI18nStore();
  const [promptPrefs, setPromptPrefs] = useState<PromptPreferences>(DEFAULT_PREFS);
  const [syncSystemLanguageToModel, setSyncSystemLanguageToModel] = useState(false);
  const [youtubePrompt, setYoutubePrompt] = useState('');
  // null while the field is not being edited, so the built-in text tracks a language switch.
  const [youtubeDraft, setYoutubeDraft] = useState<string | null>(null);
  const youtubeDefault = t('youtube.prompt.default');
  const youtubePromptText = youtubeDraft ?? (youtubePrompt || youtubeDefault);
  const youtubeCustomized = youtubePromptToStore(youtubePromptText, youtubeDefault) !== '';

  useEffect(() => {
    void settingsApi.getPromptPreferences().then(setPromptPrefs);
    void settingsApi.getSyncSystemLanguageToModel().then(setSyncSystemLanguageToModel);
    void settingsApi.getYoutubePrompt().then(setYoutubePrompt);
  }, []);

  const savePromptPrefs = useCallback(async (prefs: PromptPreferences) => {
    useAppStore.getState().setUserNickname(prefs.nickname ?? '');
    await settingsApi.updatePromptPreferences(prefs);
  }, []);

  const commitYoutubePrompt = useCallback(async (text: string) => {
    const stored = youtubePromptToStore(text, youtubeDefault);
    setYoutubePrompt(stored);
    setYoutubeDraft(null);
    await settingsApi.updateYoutubePrompt(stored);
  }, [youtubeDefault]);

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
    youtubeCustomized,
    setYoutubeDraft,
    commitYoutubePrompt,
    savePromptPrefs,
    handleToggleSyncSystemLanguageToModel,
    handleToneChange,
    handleLengthChange,
    applyPromptReset,
  };
}
