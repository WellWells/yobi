import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChartLine, CircleUserRound, DatabaseBackup, ImageDown, MessageSquare, Palette, Plug, SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../../../store/i18nStore';
import { useAppStore } from '../../../store/appStore';
import { buildHaystacks, CATEGORY_TAG_MAP, TAG_SETS } from './settingsSearch';
import type { Category } from './settingsSearch';

export { TAG_SETS } from './settingsSearch';
export type { Category } from './settingsSearch';

export function useSettingsNav() {
  const { t, locale, translations, enTranslations } = useI18nStore(
    useShallow((s) => ({
      t: s.t,
      locale: s.locale,
      translations: s.translations,
      enTranslations: s.enTranslations,
    })),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('general');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onFindHotkey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'f') return;
      if (useAppStore.getState().currentView !== 'settings') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', onFindHotkey);
    return () => window.removeEventListener('keydown', onFindHotkey);
  }, []);

  // English stays searchable in every locale — brand and jargon queries ("mcp", "byok") are typed as-is.
  const haystacks = useMemo(
    () => buildHaystacks(
      translations === enTranslations ? [translations] : [translations, enTranslations],
      (category) => t(`settings.group.${category}`),
    ),
    [translations, enTranslations, t],
  );

  const q = searchQuery.trim().toLowerCase();
  const isSearching = q.length > 0;

  const sectionVisible = (tags: readonly string[]): boolean => haystacks.get(tags)?.includes(q) ?? false;

  const showSection = (tags: readonly string[], category: Category): boolean =>
    isSearching ? sectionVisible(tags) : activeCategory === category;

  const showCategory = (category: Category): boolean => {
    if (!isSearching) return activeCategory === category;
    return CATEGORY_TAG_MAP[category].some((key) => sectionVisible(TAG_SETS[key]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const navCategoryDefs = useMemo(() => [
    { id: 'general' as Category, label: t('settings.group.general'), icon: React.createElement(SlidersHorizontal, { size: 14 }) },
    { id: 'appearance' as Category, label: t('settings.group.appearance'), icon: React.createElement(Palette, { size: 14 }) },
    { id: 'export' as Category, label: t('settings.group.export'), icon: React.createElement(ImageDown, { size: 14 }) },
    { id: 'ai' as Category, label: t('settings.group.ai'), icon: React.createElement(Bot, { size: 14 }) },
    { id: 'accounts' as Category, label: t('settings.group.accounts'), icon: React.createElement(CircleUserRound, { size: 14 }) },
    { id: 'connectors' as Category, label: t('settings.group.connectors'), icon: React.createElement(Plug, { size: 14 }) },
    { id: 'bots' as Category, label: t('settings.group.bots'), icon: React.createElement(MessageSquare, { size: 14 }) },
    { id: 'stats' as Category, label: t('settings.group.stats'), icon: React.createElement(ChartLine, { size: 14 }) },
    { id: 'system' as Category, label: t('settings.group.system'), icon: React.createElement(DatabaseBackup, { size: 14 }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale]);

  return {
    searchQuery,
    setSearchQuery,
    searchInputRef,
    activeCategory,
    setActiveCategory,
    isSearching,
    showSection,
    showCategory,
    navCategoryDefs,
  };
}
