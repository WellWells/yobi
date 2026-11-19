import type { MenuProps } from '@mantine/core';

/** Breathing room kept between the model menu and the window edge. */
const MODEL_MENU_EDGE_GAP = 8;
/** Below this the menu stops shrinking: a scrollable four rows beats an unreadable sliver. */
export const MODEL_MENU_MIN_HEIGHT = 160;

/** The height the model menu may take, given the room on its side of the button. */
export function modelMenuMaxHeight(availableHeight: number): number {
  return Math.max(MODEL_MENU_MIN_HEIGHT, Math.floor(availableHeight));
}

/**
 * The model menu is one column that shows every row it has, the way the providers' own pickers
 * do: it is as tall as its rows and scrolls only when the window has no more room on its side of
 * the button. With room on neither side it takes the side with more. Only the height is set;
 * Mantine's default `size` apply would also stretch the max width to the whole window.
 */
export const MODEL_MENU_MIDDLEWARES: NonNullable<MenuProps['middlewares']> = {
  flip: { fallbackStrategy: 'bestFit' },
  shift: true,
  size: {
    padding: MODEL_MENU_EDGE_GAP,
    apply: ({ availableHeight, elements }) => {
      elements.floating.style.maxHeight = `${modelMenuMaxHeight(availableHeight)}px`;
    },
  },
};
