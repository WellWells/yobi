import React, { useEffect, useRef, useState } from 'react';
import { Box, Group, Modal, Text } from '@mantine/core';
import { Search } from 'lucide-react';
import { AppTextInput } from './AppTextInput';
import { ShortcutHint } from './ShortcutHint';
import { useI18nStore } from '../store/i18nStore';
import styles from './SearchPalette.module.css';

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
  emptyLabel: string;
}

export function SearchPalette<T>({
  opened, onClose, query, onQueryChange, items, getKey, renderRow, onSelect, placeholder, emptyLabel,
}: SearchPaletteProps<T>): React.ReactElement {
  const { t } = useI18nStore();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!opened) return;
    onQueryChange('');
    setActiveIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  useEffect(() => { setActiveIndex(0); }, [query]);
  useEffect(() => {
    setActiveIndex((i) => Math.min(Math.max(i, 0), Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
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
      withCloseButton={false}
      padding={0}
      size={560}
      radius="md"
      yOffset="12vh"
      xOffset={0}
      styles={{
        content: { background: 'var(--bg-secondary)', border: '1px solid var(--border)', overflow: 'hidden' },
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
          leftSection={<Search size={17} />}
          classNames={{ input: styles.input }}
          styles={{
            input: { fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)', background: 'transparent', border: 'none' },
            section: { color: 'var(--text-muted)' },
          }}
        />
      </Box>

      <Box ref={listRef} style={{ maxHeight: '52vh', overflowY: 'auto', padding: 6 }}>
        {items.length === 0 ? (
          <Text ta="center" c="dimmed" fz="var(--font-size-base)" py={28}>{emptyLabel}</Text>
        ) : (
          items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <Box
                key={getKey(item)}
                data-index={index}
                className={styles.row}
                data-active={String(active)}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => onSelect(item)}
              >
                {renderRow(item, active)}
              </Box>
            );
          })
        )}
      </Box>

      <Group gap={16} justify="center" py={7} style={{ borderTop: '1px solid var(--border)' }}>
        <Group gap={5} wrap="nowrap">
          <ShortcutHint combo="↑+↓" />
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
