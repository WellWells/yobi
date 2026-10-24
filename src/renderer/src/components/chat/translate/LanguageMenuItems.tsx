import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Menu, Text } from '@mantine/core';
import { Bot, Search } from 'lucide-react';
import {
  filterTranslateLanguages, languageDisplayName, translateMenuLanguages, type TranslateLanguage,
} from '../../../../../shared/translateLanguages';
import { useI18nStore } from '../../../store/i18nStore';
import { useTranslateStore } from '../../../store/translateStore';
import { useWritingToolsStore } from '../../../store/writingToolsStore';
import { AppTextInput } from '../../AppTextInput';
import { ModelMenuItems } from '../ModelMenuItems';
import { ensureWritingModel } from '../writingToolsActions';
import {
  clearMenuActive, isComposingKey, isMenuNavKey, isTypingKey, menuDropdownOf, menuItemsOf, moveMenuActive,
  pickMenuActive, setMenuActive, watchSubmenuKeyboardFocus,
} from './menuSearchNav';
import { useProviderLabel } from './useTurnTranslation';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface LanguageMenuItemsProps {
  defaultTag: TranslateLanguage;
  onPick: (tag: TranslateLanguage) => void;
  /** Which side the nested menus open to (the ⋮ sits at the window's right edge). */
  subPosition?: 'left-start' | 'right-start';
  /**
   * When the search box takes focus. `open`: as the menu opens (a menu of its own, whose `Menu`
   * sets `withInitialFocusPlaceholder={false}` so the focus trap lands here). `keyboard`: in a
   * submenu, only when it was opened from the keyboard — opened by hovering past it, focus stays
   * where the reader was typing (the ⋮'s own search).
   */
  searchFocus?: 'open' | 'keyboard';
  t: (key: string) => string;
}

const LIST_MAX_HEIGHT = 300;
const MODEL_DROPDOWN_STYLE = { maxHeight: 320, overflowY: 'auto' } as const;

/**
 * The languages to translate into: a search box, then the recently used languages and the
 * default, then every language in name order (a query narrows it to one list), and, last, the
 * model that translates (the quick-action model the writing tools share).
 */
export const LanguageMenuItems: React.FC<LanguageMenuItemsProps> = ({
  defaultTag, onPick, subPosition = 'right-start', searchFocus = 'open', t,
}) => {
  const locale = useI18nStore((s) => s.locale);
  const recent = useTranslateStore((s) => s.recent);
  const modelUrl = useWritingToolsStore((s) => s.modelUrl);
  const chooseModel = useWritingToolsStore((s) => s.chooseModel);
  const providerLabel = useProviderLabel();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searching = query.trim() !== '';
  const { top, all } = useMemo(() => translateMenuLanguages(defaultTag, recent, locale), [defaultTag, recent, locale]);
  const matches = useMemo(() => (searching ? filterTranslateLanguages(query, locale) : []), [searching, query, locale]);

  useEffect(() => {
    void ensureWritingModel();
  }, []);

  // Layout effect: the listener is in place before Mantine's first-row focus (16 ms) can arrive.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (searchFocus !== 'keyboard' || !input) return undefined;
    return watchSubmenuKeyboardFocus(input);
  }, [searchFocus]);

  // A query highlights its first match, so Enter takes it; no query, no highlight.
  useEffect(() => {
    const dropdown = menuDropdownOf(inputRef.current);
    if (searching && matches.length > 0) setMenuActive(dropdown, menuItemsOf(dropdown)[0] ?? null);
    else clearMenuActive(dropdown);
  }, [searching, matches]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (isComposingKey(event.nativeEvent)) return;
    const dropdown = menuDropdownOf(event.currentTarget);
    if (isMenuNavKey(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      moveMenuActive(dropdown, event.key);
      return;
    }
    if (event.key !== 'Enter') return;
    if (!pickMenuActive(dropdown)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  // Focus on a row (reached with the arrow keys) and a letter typed: the letter goes to the search.
  const redirectTyping = (event: React.KeyboardEvent): void => {
    if (event.target === inputRef.current || !isTypingKey(event)) return;
    event.stopPropagation();
    inputRef.current?.focus();
  };

  const item = (section: string) => (tag: TranslateLanguage): React.ReactNode => (
    <Menu.Item key={`${section}-${tag}`} onClick={() => onPick(tag)}>
      {languageDisplayName(tag, locale)}
    </Menu.Item>
  );

  const searchLabel = t('chat.translate.menu.search');

  return (
    <>
      <Box p={4} pb={2}>
        <AppTextInput
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={searchLabel}
          aria-label={searchLabel}
          leftSection={<Search size={14} />}
          data-autofocus={searchFocus === 'open' || undefined}
          data-mantine-stop-propagation
        />
      </Box>
      <Box
        mah={LIST_MAX_HEIGHT}
        style={{ overflowY: 'auto' }}
        onKeyDown={redirectTyping}
        onMouseMove={(event) => clearMenuActive(menuDropdownOf(event.currentTarget))}
      >
        {searching ? (
          matches.length > 0 ? matches.map(item('match')) : (
            <Text px="sm" py={6} fz="var(--font-size-sm)" c="var(--text-muted)">{t('chat.translate.menu.noMatch')}</Text>
          )
        ) : (
          <>
            <Menu.Label>{t('chat.translate.menu.to')}</Menu.Label>
            {top.map(item('top'))}
            <Menu.Label>{t('chat.translate.menu.all')}</Menu.Label>
            {all.map(item('all'))}
          </>
        )}
      </Box>
      <Menu.Divider />
      <Menu.Sub position={subPosition}>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<Bot size={14} />}>
            <Text inherit truncate maw={220}>
              {fillTemplate(t('chat.translate.menu.model'), { model: modelUrl ? providerLabel(modelUrl) : '…' })}
            </Text>
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown style={MODEL_DROPDOWN_STYLE}>
          <ModelMenuItems value={modelUrl} onChange={chooseModel} />
        </Menu.Sub.Dropdown>
      </Menu.Sub>
    </>
  );
};
