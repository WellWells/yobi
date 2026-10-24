import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bot, Brain, ChartLine, Cpu, DatabaseBackup, ImageDown, Keyboard, Link, Palette, Plug, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useI18nStore } from '../../../store/i18nStore';
import { useAppStore } from '../../../store/appStore';
import type { LucideIcon } from 'lucide-react';
import { buildHaystacks, CATEGORY_IDS, CATEGORY_TAG_MAP, DEFAULT_SETTINGS_CATEGORY, TAG_SETS } from './settingsSearch';
import type { Category } from './settingsSearch';
import { useShortcutAction } from '../../../shortcuts/useShortcutAction';

export { TAG_SETS } from './settingsSearch';
export type { Category } from './settingsSearch';

// The nav lists categories in CATEGORY_IDS order; this only says which glyph each one wears.
const CATEGORY_ICON: Record<Category, LucideIcon> = {
  accounts: Cpu,
  ai: Sparkles,
  memory: Brain,
  connectors: Plug,
  bots: Bot,
  general: SlidersHorizontal,
  appearance: Palette,
  notifications: Bell,
  links: Link,
  export: ImageDown,
  shortcuts: Keyboard,
  stats: ChartLine,
  system: DatabaseBackup,
};

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
  const [activeCategory, setActiveCategory] = useState<Category>(DEFAULT_SETTINGS_CATEGORY);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const categoryRequest = useAppStore((s) => s.settingsCategoryRequest);

  useEffect(() => {
    if (!categoryRequest) return;
    if ((CATEGORY_IDS as readonly string[]).includes(categoryRequest)) {
      setSearchQuery('');
      setActiveCategory(categoryRequest as Category);
    }
    useAppStore.getState().clearSettingsCategoryRequest();
  }, [categoryRequest]);

  useShortcutAction('nav.find', () => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, 'settings');

  useShortcutAction('nav.openShortcuts', () => {
    useAppStore.getState().setView('settings');
    setSearchQuery('');
    setActiveCategory('shortcuts');
  });

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

  const navCategoryDefs = useMemo(() => CATEGORY_IDS.map((id) => ({
    id,
    label: t(`settings.group.${id}`),
    icon: React.createElement(CATEGORY_ICON[id], { size: 14 }),
  })), [locale]);

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
