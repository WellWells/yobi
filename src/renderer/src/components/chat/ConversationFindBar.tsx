import React, { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Box, Group, Paper, Text } from '@mantine/core';
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { comboLabel } from '../../../../shared/shortcuts';
import { ToolbarIconButton, ToolbarSearchInput } from '../PanelToolbar';
import { FIND_BAR_ATTR, useConversationFind } from '../../hooks/useConversationFind';
import { useConversationFindStore } from '../../store/conversationFindStore';
import { matchesShortcut, useResolvedCombo } from '../../store/shortcutStore';
import { isMac } from '../../utils/keyLabels';

interface ConversationFindBarProps {
  /** The chat's scroll area; the bar sits at its top-right and searches what it shows. */
  containerRef: RefObject<HTMLElement | null>;
  /** Names the open conversation, so switching lands on the new one's first match. */
  resetKey: string;
  /** Where focus goes when the bar closes (the composer). */
  onClosed: () => void;
  t: (key: string) => string;
}

const BAR_INPUT_WIDTH = 220;

export const ConversationFindBar: React.FC<ConversationFindBarProps> = ({ containerRef, resetKey, onClosed, t }) => {
  const { open, query, caseSensitive, wholeWord, focusToken } = useConversationFindStore(useShallow((s) => ({
    open: s.open,
    query: s.query,
    caseSensitive: s.caseSensitive,
    wholeWord: s.wholeWord,
    focusToken: s.focusToken,
  })));
  const { setQuery, close, toggleCaseSensitive, toggleWholeWord } = useConversationFindStore(useShallow((s) => ({
    setQuery: s.setQuery,
    close: s.close,
    toggleCaseSensitive: s.toggleCaseSensitive,
    toggleWholeWord: s.toggleWholeWord,
  })));
  const { count, current, next, previous } = useConversationFind(containerRef, resetKey);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKeys = comboLabel(useResolvedCombo('chatFind.next'), isMac);
  const previousKeys = comboLabel(useResolvedCombo('chatFind.previous'), isMac);

  // Every Ctrl+F lands in the field with its text selected, ready to type over.
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [open, focusToken]);

  const handleClose = useCallback((): void => {
    close();
    onClosed();
  }, [close, onClosed]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Enter confirms an IME candidate (Zhuyin, Cangjie); it must not jump while composing.
    if (event.nativeEvent.isComposing) return;
    if (matchesShortcut(event, 'chatFind.previous')) {
      event.preventDefault();
      previous();
    } else if (matchesShortcut(event, 'chatFind.next')) {
      event.preventDefault();
      next();
    } else if (matchesShortcut(event, 'chatFind.close')) {
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }
  }, [next, previous, handleClose]);

  if (!open) return null;

  const counter = count > 0
    ? `${current + 1}/${count}`
    : (query.trim() ? t('chat.find.none') : '');

  return (
    <Box
      {...{ [FIND_BAR_ATTR]: '' }}
      style={{
        position: 'sticky',
        top: 8,
        height: 0,
        zIndex: 20,
        display: 'flex',
        justifyContent: 'flex-end',
        paddingRight: 16,
        pointerEvents: 'none',
      }}
    >
      <Paper
        withBorder
        shadow="md"
        radius="md"
        p={4}
        role="search"
        style={{ pointerEvents: 'auto', background: 'var(--bg-secondary)', height: 'fit-content' }}
      >
        <Group gap={2} wrap="nowrap">
          <ToolbarSearchInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.find.placeholder')}
            clearLabel={t('chat.find.clear')}
            flex="0 0 auto"
            miw={BAR_INPUT_WIDTH}
          />
          <Text
            fz="var(--font-size-xs)"
            c={count === 0 && query.trim() ? 'var(--mantine-color-error)' : 'var(--text-muted)'}
            miw={52}
            ta="center"
            aria-live="polite"
            style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            {counter}
          </Text>
          <ToolbarIconButton
            icon={CaseSensitive}
            label={t('chat.find.caseSensitive')}
            active={caseSensitive}
            onClick={toggleCaseSensitive}
          />
          <ToolbarIconButton
            icon={WholeWord}
            label={t('chat.find.wholeWord')}
            active={wholeWord}
            onClick={toggleWholeWord}
          />
          <ToolbarIconButton
            icon={ChevronUp}
            label={t('chat.find.previous').replace('{{shortcut}}', previousKeys)}
            disabled={count === 0}
            onClick={previous}
          />
          <ToolbarIconButton
            icon={ChevronDown}
            label={t('chat.find.next').replace('{{shortcut}}', nextKeys)}
            disabled={count === 0}
            onClick={next}
          />
          <ToolbarIconButton icon={X} label={t('chat.find.close')} onClick={handleClose} />
        </Group>
      </Paper>
    </Box>
  );
};
