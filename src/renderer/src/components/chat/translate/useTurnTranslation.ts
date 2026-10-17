import { useMemo } from 'react';
import type { TurnMeta, TurnTranslation } from '../../../../../shared/conversationDoc';
import { fnv1a } from '../../../../../shared/fnv1a';
import { readTurnTranslation } from '../../../../../shared/translate';
import { findModelOption } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import { NEW_CONVERSATION_KEY } from '../../../store/appStore';
import {
  translateBusy, turnKey, useTranslateStore, type TranslationView, type TurnTranslateJob,
} from '../../../store/translateStore';

export interface TurnTranslationState {
  key: string;
  translation: TurnTranslation | null;
  /** The answer changed since it was translated. */
  outdated: boolean;
  job: TurnTranslateJob | undefined;
  busy: boolean;
  view: TranslationView;
}

/**
 * One answer's translation: from its marker in a saved conversation, from memory in the temporary
 * chat. A temporary chat's translation of a different answer at the same place is not shown at all.
 */
export function useTurnTranslation(path: string, turnIndex: number, meta: TurnMeta, response: string): TurnTranslationState {
  const key = turnKey(path, turnIndex);
  const temp = !path || path === NEW_CONVERSATION_KEY;
  const job = useTranslateStore((s) => s.jobs[key]);
  const remembered = useTranslateStore((s) => (temp ? s.memory[key] : undefined));
  const view = useTranslateStore((s) => s.views[key] ?? 'both');
  const hash = useMemo(() => fnv1a(response.trim()), [response]);
  const stored = temp ? remembered ?? null : readTurnTranslation(meta);
  const outdated = stored !== null && stored.h !== hash;
  const translation = temp && outdated ? null : stored;
  return { key, translation, outdated: translation !== null && outdated, job, busy: translateBusy(job), view };
}

/** The provider's name as menus show it, for "translated by". */
export function useProviderLabel(): (url: string) => string {
  const { extraModels } = useProviderModels('');
  return useMemo(() => (url: string) => findModelOption(url, extraModels).label, [extraModels]);
}
