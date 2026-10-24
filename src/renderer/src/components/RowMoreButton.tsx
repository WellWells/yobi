import React from 'react';
import { ActionIcon } from '@mantine/core';
import { MoreHorizontal } from 'lucide-react';

export interface MenuAnchor {
  x: number;
  y: number;
}

/** Where a row menu opened from its "⋯" button starts: under the button's left edge. */
export function menuAnchorBelow(rect: Pick<DOMRect, 'left' | 'bottom'>): MenuAnchor {
  return { x: Math.round(rect.left), y: Math.round(rect.bottom) };
}

interface RowMoreButtonProps {
  label: string;
  /** The row's menu is open; the button stays visible and says so to assistive tech. */
  menuOpen: boolean;
  onOpen: (at: MenuAnchor) => void;
  className?: string;
}

/**
 * The "⋯" at a list row's right edge: the row's right-click menu, for a mouse without a second
 * button and for the keyboard. The row decides when it shows (hover, focus, selection, menu open)
 * through `className`. A press on it is the button's alone: it must not open or select the row,
 * start dragging a conversation out of the window (mousedown's default is what starts a drag), or
 * pick a flow up for sorting (dnd-kit listens for pointerdown and Enter/Space on the row).
 */
export const RowMoreButton: React.FC<RowMoreButtonProps> = ({ label, menuOpen, onOpen, className }) => (
  <ActionIcon
    variant="subtle"
    size="sm"
    radius="xl"
    c="dimmed"
    className={className}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    data-menu-open={menuOpen || undefined}
    draggable={false}
    onMouseDown={(e) => {
      // Also keeps the open menu's outside-click close from firing: the click below toggles it.
      e.preventDefault();
      e.stopPropagation();
    }}
    onPointerDown={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    }}
    onClick={(e) => {
      e.stopPropagation();
      onOpen(menuAnchorBelow(e.currentTarget.getBoundingClientRect()));
    }}
  >
    <MoreHorizontal size={15} />
  </ActionIcon>
);
