import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Box, Group, Modal, Text } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { AppTextInput } from './AppTextInput';
import { ShortcutHint } from './ShortcutHint';
import { useI18nStore } from '../store/i18nStore';
import { isComposingKey } from '../utils/imeKeys';
import { measureElementKeepLast, observeRectKeepLast } from '../utils/virtualKeepLast';
import styles from './SearchPalette.module.css';

// Two lines of text plus the row padding; rows are measured once drawn.
const ROW_ESTIMATE = 52;
const LIST_PAD = 6;
const LIST_MAX_VH = 52;

/** The id of the option at `index`: the input's `aria-activedescendant` points at it. */
export function paletteOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** The list's height cap, used until the list is measured (the palette opens straight onto it). */
function initialListHeight(): number {
  return Math.round(((typeof window === 'undefined' ? 0 : window.innerHeight) * LIST_MAX_VH) / 100);
}

interface PaletteRowProps<T> {
  item: T;
  index: number;
  id: string;
  /** The whole list's length: only a window of rows is in the DOM, so each says where it sits. */
  setSize: number;
  start: number;
  active: boolean;
  measureRef: (node: Element | null) => void;
  onHover: (index: number) => void;
  onPick: (item: T) => void;
  renderRow: (item: T, active: boolean) => React.ReactNode;
}

// Memoised on `active` (not the active index), so a move re-renders only the two rows it touches.
function PaletteRowImpl<T>({
  item, index, id, setSize, start, active, measureRef, onHover, onPick, renderRow,
}: PaletteRowProps<T>): React.ReactElement {
  return (
    <Box
      ref={measureRef}
      id={id}
      role="option"
      aria-selected={active}
      aria-setsize={setSize}
      aria-posinset={index + 1}
      data-index={index}
      className={styles.row}
      data-active={String(active)}
      onMouseMove={() => onHover(index)}
      onClick={() => onPick(item)}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start}px)` }}
    >
      {renderRow(item, active)}
    </Box>
  );
}

const PaletteRow = React.memo(PaletteRowImpl) as typeof PaletteRowImpl;

interface SearchPaletteProps<T> {
  opened: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  items: T[];
  getKey: (item: T) => string;
  renderRow: (item: T, active: boolean) => React.ReactNode;
  onSelect: (item: T) => void;
  placeholder: string;
  /** The dialog's and the result list's accessible name ("Search conversations"). */
  label: string;
  emptyLabel: string;
  /** After the close animation, once focus has gone back to where it was before the palette. */
  onClosed?: () => void;
}

export function SearchPalette<T>({
  opened, onClose, query, onQueryChange, items, getKey, renderRow, onSelect, placeholder, label, emptyLabel, onClosed,
}: SearchPaletteProps<T>): React.ReactElement {
  const t = useI18nStore((s) => s.t);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Combobox pattern (WCAG 4.1.2): focus stays in the input, and `aria-activedescendant` names the
  // highlighted option, so a screen reader announces each ↑ / ↓ move.
  const listId = `${useId()}-results`;
  const activeId = items.length > 0 ? paletteOptionId(listId, activeIndex) : undefined;

  useEffect(() => {
    if (!opened) return;
    onQueryChange('');
    setActiveIndex(0);
  }, [opened]);

  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(i, 0), Math.max(0, items.length - 1)));
  }, [items.length]);

  const getItemKey = useCallback((index: number): string | number => {
    const item = items[index];
    return item === undefined ? index : getKey(item);
  }, [items, getKey]);

  // Only the rows in view are drawn: an empty query hands over every conversation.
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey,
    overscan: 6,
    paddingStart: LIST_PAD,
    paddingEnd: LIST_PAD,
    scrollPaddingStart: LIST_PAD,
    scrollPaddingEnd: LIST_PAD,
    initialRect: { width: 0, height: initialListHeight() },
    observeElementRect: observeRectKeepLast,
    measureElement: measureElementKeepLast,
  });

  useEffect(() => {
    if (items.length > 0) rowVirtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) onSelect(item);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      onExitTransitionEnd={onClosed}
      withCloseButton={false}
      // The dialog's accessible name: Mantine labels the dialog by its title, kept out of sight here.
      title={label}
      padding={0}
      size={560}
      radius="md"
      yOffset="12vh"
      xOffset={0}
      styles={{
        content: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', overflow: 'hidden' },
        header: { display: 'none' },
        body: { padding: 0 },
      }}
    >
      <Box style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}>
        <AppTextInput
          data-autofocus
          variant="unstyled"
          size="md"
          value={query}
          onChange={(e) => onQueryChange(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          leftSection={<Search size={17} />}
          classNames={{ input: styles.input }}
          styles={{
            // No fontSize here: `size="md"` above already sets it.
            input: { color: 'var(--text-primary)', background: 'transparent', border: 'none' },
            section: { color: 'var(--text-muted)' },
          }}
        />
      </Box>

      <Box ref={listRef} style={{ maxHeight: `${LIST_MAX_VH}vh`, overflowY: 'auto', padding: `0 ${LIST_PAD}px` }}>
        {items.length === 0 ? (
          <Text ta="center" c="dimmed" fz="var(--font-size-base)" py={28 + LIST_PAD}>{emptyLabel}</Text>
        ) : (
          <Box id={listId} role="listbox" aria-label={label} style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (item === undefined) return null;
              return (
                <PaletteRow
                  key={virtualRow.key}
                  item={item}
                  index={virtualRow.index}
                  id={paletteOptionId(listId, virtualRow.index)}
                  setSize={items.length}
                  start={virtualRow.start}
                  active={virtualRow.index === activeIndex}
                  measureRef={rowVirtualizer.measureElement}
                  onHover={setActiveIndex}
                  onPick={onSelect}
                  renderRow={renderRow}
                />
              );
            })}
          </Box>
        )}
      </Box>

      <Group gap={16} justify="center" py={7} style={{ borderTop: '1px solid var(--border)' }}>
        <Group gap={5} wrap="nowrap">
          {/* Two hints, not one "Up+Down" combo: `canonicalise` keeps only one non-modifier key. */}
          <Group gap={3} wrap="nowrap">
            <ShortcutHint combo="Up" />
            <ShortcutHint combo="Down" />
          </Group>
          <Text component="span" fz="var(--font-size-xs)" c="dimmed">{t('sidebar.search.hintMove')}</Text>
        </Group>
        <Group gap={5} wrap="nowrap">
          <ShortcutHint combo="Enter" />
          <Text component="span" fz="var(--font-size-xs)" c="dimmed">{t('sidebar.search.hintOpen')}</Text>
        </Group>
        <Group gap={5} wrap="nowrap">
          <ShortcutHint combo="Esc" />
          <Text component="span" fz="var(--font-size-xs)" c="dimmed">{t('sidebar.search.hintClose')}</Text>
        </Group>
      </Group>
    </Modal>
  );
}
