import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Text } from '@mantine/core';
import { Z_POPOVER } from '../../config/zLayers';
import {
  SUGGEST_MAX_HEIGHT,
  suggestListEdge,
  suggestListMaxHeight,
  type MenuDirection,
} from './composerMenuDirection';

const LIST_WIDTH = 340;

interface ComposerSuggestListProps {
  highlightedIndex: number;
  /** Shown instead of the rows when there are none. */
  emptyLabel: string;
  isEmpty: boolean;
  /** Above the composer when it is docked at the bottom, below it on an empty chat. */
  direction: MenuDirection;
  /** Rows, each carrying `data-suggest-index` so the highlighted one can be kept in view. */
  children: React.ReactNode;
}

/** The panel beside the composer that the slash-command and `/model` lists both open in. */
export const ComposerSuggestList: React.FC<ComposerSuggestListProps> = ({
  highlightedIndex, emptyLabel, isEmpty, direction, children,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(SUGGEST_MAX_HEIGHT);
  // Measured against the composer box it hangs from (the list's positioned parent), before paint,
  // and again whenever the window is resized while the list is open.
  useLayoutEffect(() => {
    const anchor = listRef.current?.parentElement;
    if (!anchor) return undefined;
    const fit = (): void => {
      setMaxHeight(suggestListMaxHeight(direction, anchor.getBoundingClientRect(), window.innerHeight));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [direction]);
  // Arrow keys move the highlight, not the scroll, so keep the highlighted row in view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-suggest-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  return (
    <Box
      ref={listRef}
      pos="absolute"
      bg="var(--mantine-color-default)"
      w={LIST_WIDTH}
      style={{
        left: 0,
        ...suggestListEdge(direction),
        maxWidth: '100%',
        zIndex: Z_POPOVER,
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        maxHeight,
        overflowY: 'auto',
      }}
    >
      {isEmpty
        ? <Text fz="var(--font-size-sm)" c="dimmed" p="sm" ta="center">{emptyLabel}</Text>
        : children}
    </Box>
  );
};
