import React from 'react';
import { Box, Stack } from '@mantine/core';
import { PanelLeftOpen } from 'lucide-react';
import { isMac } from '../utils/keyLabels';
import { PanelToolbar, ToolbarIconButton } from './PanelToolbar';
import { RailViewNav } from './ViewNav';

// The folded sidebar: an icon rail as wide as one toolbar button and its margins. On macOS its top
// row is the traffic lights' (16px in, 52px wide), so the rail is as wide as they need.
export const RAIL_WIDTH = isMac ? 76 : 48;

interface SidebarRailProps {
  /** The way back to the whole sidebar, with its shortcut in the name. */
  expandLabel: string;
  onExpand: () => void;
  /** The other view with a sidebar, reached from the rail's foot (above Settings). */
  otherView: 'chat' | 'flow';
  /** The sidebar's own actions under the way back: its new item, then search. */
  children: React.ReactNode;
  /** Kept mounted while folded (dialogs the menu bar can open). */
  extra?: React.ReactNode;
}

/**
 * A sidebar folded, as ChatGPT's, Claude's and Gemini's: an icon rail with the way back, the
 * sidebar's new item and search, and at its foot the other view and Settings. Its top row is the
 * window's title bar over the rail; on macOS the traffic lights fill it, so the way back opens the
 * column under it. The chat and flow sidebars fold to this same rail.
 */
export const SidebarRail: React.FC<SidebarRailProps> = ({ expandLabel, onExpand, otherView, children, extra }) => {
  const expand = <ToolbarIconButton icon={PanelLeftOpen} label={expandLabel} onClick={onExpand} />;
  return (
    <Stack
      gap={0}
      w={RAIL_WIDTH}
      bg="var(--mantine-color-default)"
      style={{ borderRight: '1px solid var(--mantine-color-default-border)', overflow: 'hidden', position: 'relative', flexShrink: 0 }}
    >
      <PanelToolbar px={8} caption="left">
        {!isMac && expand}
      </PanelToolbar>
      <Stack gap={6} align="center" pt={8}>
        {isMac && expand}
        {children}
      </Stack>
      <Box flex={1} />
      <RailViewNav to={otherView} />
      {extra}
    </Stack>
  );
};
