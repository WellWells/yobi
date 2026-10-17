import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultTargetLanguage, type TranslateLanguage } from '../../../../../shared/translateLanguages';
import { useI18nStore } from '../../../store/i18nStore';
import { useTranslateStore } from '../../../store/translateStore';
import { ensureWritingModel } from '../writingToolsActions';
import { cancelTranslation, failureText, queueTranslation, rememberLanguage } from './translateActions';

export interface SelectionTranslation {
  text: string;
  /** The selection when it was taken, so the bar stays put once the selection itself is gone. */
  range: Range;
  to: TranslateLanguage;
  id: string;
  status: 'queued' | 'waiting' | 'running' | 'done' | 'error';
  result: string;
  error: string;
  /** The model lost a code block, formula or link: the result is shown as it wrote it. */
  unmatched: boolean;
  providerUrl: string;
}

export interface SelectedText {
  text: string;
  range: Range;
}

/** The page's selection, with its range copied so it outlives the selection itself. */
export function takeSelectedText(): SelectedText | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (!selection || selection.rangeCount === 0 || !text) return null;
  return { text, range: selection.getRangeAt(0).cloneRange() };
}

/**
 * Translating what is selected: the result shows in the selection bar's unfolded area and is
 * never written anywhere. A new language re-runs it; closing cancels a request still out.
 */
export function useSelectionTranslate(): {
  current: SelectionTranslation | null;
  open: (to?: TranslateLanguage, held?: SelectedText | null) => boolean;
  retarget: (to: TranslateLanguage) => void;
  close: () => void;
} {
  const [current, setCurrent] = useState<SelectionTranslation | null>(null);
  const live = useRef<SelectionTranslation | null>(null);
  live.current = current;

  const run = useCallback((text: string, range: Range, to: TranslateLanguage): void => {
    if (live.current && live.current.status !== 'done' && live.current.status !== 'error') cancelTranslation(live.current.id);
    rememberLanguage(to);
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const start: SelectionTranslation = {
      text, range, to, id, status: 'queued', result: '', error: '', unmatched: false, providerUrl: '',
    };
    live.current = start;
    setCurrent(start);
    const patch = (next: Partial<SelectionTranslation>): void => {
      setCurrent((state) => (state?.id === id ? { ...state, ...next } : state));
    };
    void ensureWritingModel().then(async (providerUrl) => {
      if (live.current?.id !== id) return;
      const queued = queueTranslation(text, to, providerUrl, (phase) => patch({ status: phase }), id);
      const result = await queued.result;
      if (result.ok) {
        patch({ status: 'done', result: result.text, unmatched: Boolean(result.unmatched), providerUrl: result.providerUrl });
      } else if (result.reason !== 'cancelled') {
        patch({ status: 'error', error: failureText(result) });
      }
    });
  }, []);

  /**
   * Translates `held` (the selection as it was when the language menu opened: typing in its
   * search takes the page's selection away) or else what is selected now, into `to` or the default.
   */
  const open = useCallback((to?: TranslateLanguage, held?: SelectedText | null): boolean => {
    const taken = held ?? takeSelectedText();
    if (!taken) return false;
    const { locale } = useI18nStore.getState();
    run(taken.text, taken.range, to ?? defaultTargetLanguage(taken.text, locale, useTranslateStore.getState().recent));
    return true;
  }, [run]);

  const retarget = useCallback((to: TranslateLanguage): void => {
    const state = live.current;
    if (state) run(state.text, state.range, to);
  }, [run]);

  const close = useCallback((): void => {
    const state = live.current;
    if (state && state.status !== 'done' && state.status !== 'error') cancelTranslation(state.id);
    setCurrent(null);
  }, []);

  // A request still out when the chat goes away is dropped with it.
  useEffect(() => () => {
    const state = live.current;
    if (state && state.status !== 'done' && state.status !== 'error') cancelTranslation(state.id);
  }, []);

  return { current, open, retarget, close };
}
