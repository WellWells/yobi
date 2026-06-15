import React, { useMemo, useState } from 'react';
import { Bot, CircleUserRound, MessageSquare, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useI18nStore } from '../../../store/i18nStore';

export type Category = 'general' | 'ai' | 'accounts' | 'bots' | 'system';

export const TAG_SETS = {
  hotkey: ['hotkey', 'keyboard', 'shortcut', 'key', 'binding', 'settings.hotkey'],
  language: ['language', 'locale', 'translation', 'i18n', 'zh', 'en', 'settings.language'],
  notify: ['notification', 'bell', 'notify', 'alert', 'settings.notifications'],
  theme: ['theme', 'dark', 'light', 'dracula', 'nord', 'amoled', 'sepia', 'appearance', 'color', 'oled', 'settings.theme'],
  timeout: ['timeout', 'timer', 'response', 'time', 'settings.responseTimeout.title'],
  prompt: ['prompt', 'persona', 'template', 'tone', 'length', 'nickname', 'settings.prompt.persona.title', 'settings.prompt.templates.title', 'settings.youtube.prompt.title', 'settings.prompt.preview.title'],
  accounts: ['account', 'accounts', 'login', 'logout', 'sign in', 'sign out', 'signin', 'session', 'chatgpt', 'gemini', 'perplexity', 'settings.group.accounts', 'settings.accounts.title'],
  bots: ['bot', 'telegram', 'line', 'token', 'pairing', 'group', 'command', 'duck', 'settings.group.bots', 'settings.telegram.section.connection', 'settings.telegram.commands.title', 'settings.telegram.section.access'],
  config: ['config', 'configuration', 'backup', 'restore', 'import', 'export', 'json', 'folder', 'directory', 'settings.config.title'],
  danger: ['danger', 'reset', 'clear', 'delete', 'restore', 'settings.danger.title'],
  tray: ['tray', 'system tray', 'menu bar', 'close', 'hide', 'startup', 'minimize', 'settings.tray.title', 'settings.tray.title.mac'],
} as const;

const CATEGORY_TAG_MAP: Record<Category, (keyof typeof TAG_SETS)[]> = {
  general: ['hotkey', 'language', 'notify', 'theme', 'tray'],
  ai: ['timeout', 'prompt'],
  accounts: ['accounts'],
  bots: ['bots'],
  system: ['config', 'danger'],
};

export function useSettingsNav() {
  const { t, locale } = useI18nStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('general');

  const q = searchQuery.trim().toLowerCase();
  const isSearching = q.length > 0;

  const sectionVisible = (tags: readonly string[]): boolean =>
    tags.some((tag) => {
      const text = tag.includes('.') ? t(tag) : tag;
      return text.toLowerCase().includes(q);
    });

  const showSection = (tags: readonly string[], category: Category): boolean =>
    isSearching ? sectionVisible(tags) : activeCategory === category;

  const showCategory = (category: Category): boolean => {
    if (!isSearching) return activeCategory === category;
    return CATEGORY_TAG_MAP[category].some((key) => sectionVisible(TAG_SETS[key]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const navCategoryDefs = useMemo(() => [
    { id: 'general' as Category, label: t('settings.group.general'), icon: React.createElement(SlidersHorizontal, { size: 14 }) },
    { id: 'ai' as Category, label: t('settings.group.ai'), icon: React.createElement(Bot, { size: 14 }) },
    { id: 'accounts' as Category, label: t('settings.group.accounts'), icon: React.createElement(CircleUserRound, { size: 14 }) },
    { id: 'bots' as Category, label: t('settings.group.bots'), icon: React.createElement(MessageSquare, { size: 14 }) },
    { id: 'system' as Category, label: t('settings.group.system'), icon: React.createElement(ShieldAlert, { size: 14 }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale]);

  return {
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    isSearching,
    showSection,
    showCategory,
    navCategoryDefs,
  };
}
