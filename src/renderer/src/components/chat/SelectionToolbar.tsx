import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Divider, Group, Menu, NavLink, ScrollArea, Text } from '@mantine/core';
import { useMergedRef } from '@mantine/hooks';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { CitationSource } from '../../../../shared/citations';
import { citationHost } from '../../../../shared/citations';
import { usePressOutside } from '../../hooks/usePressOutside';
import { WRITING_PANEL_HEIGHT } from './WritingToolsPanel';
import { PLACEMENT_EDGE, placeSelectionBar, type PlacementBounds } from './selectionPlacement';

export interface SelectionAction {
  id: string;
  label: string;
  Icon: LucideIcon;
  run: () => void;
  /** Opens more below the row (the writing tools): drawn with a chevron, highlighted while open. */
  expands?: boolean;
  active?: boolean;
  /** Opens on hover (the languages to translate into) while a click still runs the action. */
  hoverMenu?: SelectionHoverMenu;
}

export interface SelectionHoverMenu {
  content: React.ReactNode;
  onOpenChange?: (opened: boolean) => void;
}

export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

interface SelectionToolbarProps {
  rect: SelectionRect;
  actions: SelectionAction[];
  sources: CitationSource[];
  sourcesOpen: boolean;
  sourcesLabel: string;
  onOpenSource: (url: string) => void;
  /** The writing tools (or a translation), unfolded under the row. */
  panel?: React.ReactNode;
  /** How tall the unfolded panel can get, to choose where it goes; the writing tools' by default. */
  panelHeight?: number;
  /** The conversation's scroll area on screen: the bar stays inside it. The window when absent. */
  bounds?: PlacementBounds;
  t: (key: string) => string;
}

const MAX_WIDTH = 460;
const EDGE_MARGIN = PLACEMENT_EDGE;
const COLLAPSED_HEIGHT = 38;
const EXPANDED_HEIGHT = 268;

const HOVER_OPEN_DELAY_MS = 120;
const HOVER_CLOSE_DELAY_MS = 200;
const MENU_SURFACES = '.mantine-Menu-dropdown';

/**
 * An action whose menu opens on hover: a click runs the action itself (translate into the
 * default), the menu offers the alternatives. Hovering away while typing in the menu's search does
 * not close it (the pointer drifts while typing); a press outside it, a pick, or a click on the
 * action does.
 */
const HoverMenuAction: React.FC<{
  menu: SelectionHoverMenu;
  run: () => void;
  button: (onClick: () => void) => React.ReactElement;
}> = ({ menu, run, button }) => {
  const [opened, setOpened] = useState(false);
  const targetRef = useRef<HTMLDivElement>(null);
  const onOpenChange = useRef(menu.onOpenChange);
  onOpenChange.current = menu.onOpenChange;

  const set = useCallback((next: boolean): void => {
    setOpened(next);
    onOpenChange.current?.(next);
  }, []);

  const change = (next: boolean): void => {
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement && Boolean(active.closest(MENU_SURFACES));
    if (!next && typing) return;
    set(next);
  };

  usePressOutside([targetRef], () => set(false), opened);

  // Unmounted while open (the action left the bar): whoever held the selection for it lets go.
  useEffect(() => () => onOpenChange.current?.(false), []);

  return (
    <Menu
      trigger="hover"
      openDelay={HOVER_OPEN_DELAY_MS}
      closeDelay={HOVER_CLOSE_DELAY_MS}
      opened={opened}
      onChange={change}
      position="bottom-start"
      offset={4}
      withinPortal
      shadow="md"
      trapFocus={false}
    >
      <Menu.Target>
        <Box ref={targetRef} style={{ display: 'flex', flexShrink: 0 }}>
          {button(() => {
            set(false);
            run();
          })}
        </Box>
      </Menu.Target>
      <Menu.Dropdown miw={220}>{menu.content}</Menu.Dropdown>
    </Menu>
  );
};

/**
 * The bar over a selection, after Photoshop's contextual task bar: the few things to do with what
 * is selected, in one row, with the writing tools unfolding beneath it instead of in a dialog.
 */
export const SelectionToolbar = React.forwardRef<HTMLDivElement, SelectionToolbarProps>(({
  rect,
  actions,
  sources,
  sourcesOpen,
  sourcesLabel,
  onOpenSource,
  panel,
  panelHeight = WRITING_PANEL_HEIGHT,
  bounds,
  t,
}, ref) => {
  const extra = panel ? panelHeight : sourcesOpen ? EXPANDED_HEIGHT - COLLAPSED_HEIGHT : 0;
  const boxRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRef(ref, boxRef);
  // The row is as wide as its buttons (they never shrink, so a label is never clipped); the bar is
  // placed by its measured width (`placeSelectionBar`).
  const [size, setSize] = useState({ box: MAX_WIDTH, row: 0 });
  useLayoutEffect(() => {
    const box = boxRef.current?.offsetWidth ?? MAX_WIDTH;
    const row = rowRef.current?.scrollWidth ?? 0;
    setSize((prev) => (prev.box === box && prev.row === row ? prev : { box, row }));
  });
  const maxWidth = Math.min(Math.max(MAX_WIDTH, size.row), window.innerWidth - EDGE_MARGIN * 2);
  // Kept inside the conversation, not the window: the title bar and the header are above it.
  const placement = placeSelectionBar({
    rect,
    bounds: bounds ?? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth },
    width: Math.min(size.box, maxWidth),
    height: COLLAPSED_HEIGHT + extra,
    unfolded: Boolean(panel),
  });

  return (
    <Box
      ref={mergedRef}
      pos="fixed"
      top={placement.top}
      left={placement.left}
      maw={maxWidth}
      bg="var(--bg-tertiary)"
      data-placement={placement.side}
      style={{
        zIndex: 130,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: placement.maxHeight,
        transform: placement.side === 'above' ? 'translateY(-100%)' : undefined,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
      }}
    >
      {/* Keeps the selection: a press on the row must not collapse what it acts on. React also
          delivers presses in a button's portalled menu here; those must still reach its search box. */}
      <Group
        ref={rowRef}
        gap={0}
        wrap="nowrap"
        align="stretch"
        style={{ flexShrink: 0 }}
        onMouseDown={(event) => {
          if (event.currentTarget.contains(event.target as Node)) event.preventDefault();
        }}
      >
        {actions.map(({ id, label, Icon, run, expands, active, hoverMenu }, index) => {
          const button = (onClick: () => void): React.ReactElement => (
            <Button
              variant={active ? 'light' : 'subtle'}
              size="compact-sm"
              radius={0}
              h={COLLAPSED_HEIGHT}
              px={12}
              c="var(--text-primary)"
              style={{ flexShrink: 0 }}
              leftSection={<Icon size={14} />}
              rightSection={expands || hoverMenu ? <ChevronDown size={12} /> : undefined}
              aria-label={label}
              aria-expanded={expands ? Boolean(active) : undefined}
              onClick={onClick}
              styles={{
                label: { fontSize: 'var(--font-size-base)', fontWeight: 500 },
                section: { marginInlineEnd: 6, color: 'var(--text-muted)' },
              }}
            >
              {label}
            </Button>
          );
          return (
            <React.Fragment key={id}>
              {index > 0 && <Box my={7} w={1} bg="var(--border)" style={{ flexShrink: 0 }} />}
              {hoverMenu ? <HoverMenuAction menu={hoverMenu} run={run} button={button} /> : button(run)}
            </React.Fragment>
          );
        })}
      </Group>

      {panel && (
        <>
          <Divider color="var(--border)" style={{ flexShrink: 0 }} />
          {/* Takes what is left of the capped height; the panel scrolls its own list inside it. */}
          <Box style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>{panel}</Box>
        </>
      )}

      {!panel && sourcesOpen && sources.length > 0 && (
        <>
          <Divider color="var(--border)" />
          <Text px={14} pt={10} pb={6} fz="var(--font-size-sm)" fw={600} c="var(--text-muted)">
            {sourcesLabel}
          </Text>
          <ScrollArea.Autosize mah={EXPANDED_HEIGHT - COLLAPSED_HEIGHT - 34} type="auto">
            {sources.map((source) => (
              <NavLink
                key={source.id}
                label={source.title}
                description={citationHost(source.url)}
                px={14}
                py={7}
                leftSection={(
                  <Text fz="var(--font-size-sm)" fw={700} c="var(--text-muted)" w={14} ta="center">
                    {source.id}
                  </Text>
                )}
                aria-label={`${t('chat.selection.openSource')} ${source.title}`}
                onClick={() => onOpenSource(source.url)}
              />
            ))}
          </ScrollArea.Autosize>
        </>
      )}
    </Box>
  );
});

SelectionToolbar.displayName = 'SelectionToolbar';
