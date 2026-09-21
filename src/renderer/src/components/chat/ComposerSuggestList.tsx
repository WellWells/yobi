import React, { useEffect, useRef } from 'react';
import { Box, Text } from '@mantine/core';
import { Z_POPOVER } from '../../config/zLayers';

const LIST_WIDTH = 340;
const LIST_MAX_HEIGHT = 320;

interface ComposerSuggestListProps {
  highlightedIndex: number;
  /** Shown instead of the rows when there are none. */
  emptyLabel: string;
  isEmpty: boolean;
  /** Rows, each carrying `data-suggest-index` so the highlighted one can be kept in view. */
  children: React.ReactNode;
}

/** The panel above the composer that the slash-command and `/model` lists both open in. */
export const ComposerSuggestList: React.FC<ComposerSuggestListProps> = ({
  highlightedIndex, emptyLabel, isEmpty, children,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  // The list is a fixed-height scroll box and arrow keys move the highlight, not the scroll —
  // so anything past the first few rows was highlighted off-screen. `block: 'nearest'` leaves an
  // already-visible row where it is, matching how the flow sidebar and the model menu behave.
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
        bottom: '100%',
        maxWidth: '100%',
        marginBottom: 6,
        zIndex: Z_POPOVER,
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
        maxHeight: LIST_MAX_HEIGHT,
        overflowY: 'auto',
      }}
    >
      {isEmpty
        ? <Text fz="var(--font-size-sm)" c="dimmed" p="sm" ta="center">{emptyLabel}</Text>
        : children}
    </Box>
  );
};
