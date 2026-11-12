import React, { useLayoutEffect } from 'react';
import { Box, Group } from '@mantine/core';
import { useDragScroll, wheelScrollsSideways } from '../../hooks/useDragScroll';
import { useScrollEnds } from '../../hooks/useScrollEnds';
import { SCROLL_CHEVRON_SLOT, ScrollChevron } from '../../components/ScrollChevron';
import classes from './SettingsTabStrip.module.css';

/**
 * Room left beside the active tab when the row brings it into view. It includes a chevron's
 * slot: the scroll can bring the other end's chevron in, which narrows the row by that much and
 * would push the tab just revealed back under the edge.
 */
const REVEAL_MARGIN = 8 + SCROLL_CHEVRON_SLOT;

interface SettingsTabStripProps {
  /** Which tab is active: when it changes, the row brings it into view. */
  activeKey: string;
  children: React.ReactNode;
}

/**
 * Settings' nav as a row of tabs under the search, for a dialog too narrow for the nav beside the
 * column (Claude's settings on a narrow window). It scrolls sideways by wheel and drag, and a
 * chevron shows at an end while there are tabs past it.
 */
export const SettingsTabStrip: React.FC<SettingsTabStripProps> = ({ activeKey, children }) => {
  const { ref: stripRef, ends, measure, page } = useScrollEnds<HTMLDivElement>();
  const dragScroll = useDragScroll();

  // Within the row only: `scrollIntoView` would also scroll the dialog's clipped ancestors.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector('[data-active]');
    if (!strip || !tab) return;
    const row = strip.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < row.left) strip.scrollLeft += box.left - row.left - REVEAL_MARGIN;
    else if (box.right > row.right) strip.scrollLeft += box.right - row.right + REVEAL_MARGIN;
  }, [activeKey, stripRef]);

  return (
    <Group gap={4} wrap="nowrap" px={12} pb={8} style={{ flexShrink: 0 }}>
      {ends.back && <ScrollChevron direction="back" onClick={() => page(-1)} />}
      <Box
        ref={stripRef}
        component="nav"
        className={classes.strip}
        flex={1}
        miw={0}
        onScroll={measure}
        onWheel={wheelScrollsSideways}
        {...dragScroll}
      >
        {children}
      </Box>
      {ends.forward && <ScrollChevron direction="forward" onClick={() => page(1)} />}
    </Group>
  );
};
