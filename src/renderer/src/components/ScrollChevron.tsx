import React from 'react';
import { ActionIcon } from '@mantine/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** The button and the row's gap after it, for a row that keeps room for a chevron. */
export const SCROLL_CHEVRON_SLOT = 30 + 4;

interface ScrollChevronProps {
  direction: 'back' | 'forward';
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A chevron at an end of a sideways-scrolling row (see `useScrollEnds`). A pointer's shortcut
 * only, so it is out of the tab order and hidden from screen readers: every item in the row is
 * reachable with Tab, and a focused item scrolls itself into view.
 */
export const ScrollChevron: React.FC<ScrollChevronProps> = ({ direction, onClick, disabled = false }) => {
  const Icon = direction === 'back' ? ChevronLeft : ChevronRight;
  return (
    <ActionIcon
      variant="subtle"
      size={30}
      radius="sm"
      tabIndex={-1}
      aria-hidden
      disabled={disabled}
      onClick={onClick}
      style={{ flexShrink: 0 }}
    >
      <Icon size={15} />
    </ActionIcon>
  );
};
