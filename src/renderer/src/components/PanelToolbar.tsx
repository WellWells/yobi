import React from 'react';
import { ActionIcon, Box, Group, Tooltip } from '@mantine/core';
import { Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppTextInput } from './AppTextInput';
import { useResolvedCombo } from '../store/shortcutStore';
import { comboLabel } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';
import { CAPTION_ROW, captionPad, type CaptionEdge } from './titlebar/constants';

/**
 * Vertical padding of a panel toolbar. With a 30px control and the 1px rule that makes the 47px
 * band beside the sidebar; a view's own top band uses the same value so its controls sit on the
 * same line.
 */
export const PANEL_TOOLBAR_PY = 8;

/** A top row without its rule: the height the caption controls floating over the rows take. */
export const TOP_ROW_HEIGHT = PANEL_TOOLBAR_PY * 2 + 30;

export interface PanelToolbarProps {
  children?: React.ReactNode;
  px?: number;
  py?: string | number;
  gap?: number;
  withBottomBorder?: boolean;
  justify?: React.ComponentProps<typeof Group>['justify'];
  /** A view's top row is the window's title bar: this side (or both) is the window's edge. */
  caption?: CaptionEdge;
  /** For a toolbar that lays itself out by its pane's width (a container query). */
  className?: string;
}

export const PanelToolbar: React.FC<PanelToolbarProps> = ({
  children,
  px = 10,
  py = PANEL_TOOLBAR_PY,
  gap = 8,
  withBottomBorder = true,
  justify = 'space-between',
  caption,
  className,
}) => (
  <Group
    {...(caption ? CAPTION_ROW : undefined)}
    className={className}
    wrap="nowrap"
    gap={gap}
    pl={captionPad(caption, 'left', px)}
    pr={captionPad(caption, 'right', px)}
    py={py}
    // Holds its height with nothing in it too: on macOS a rail's top row is only the traffic lights.
    mih={caption ? TOP_ROW_HEIGHT + (withBottomBorder ? 1 : 0) : undefined}
    justify={justify}
    style={{
      borderBottom: withBottomBorder ? '1px solid var(--mantine-color-default-border)' : undefined,
      flexShrink: 0,
    }}
  >
    {children}
  </Group>
);

/**
 * A stretch of title bar with nothing in it, over a pane whose own content starts lower: the window
 * drags by it and the caption controls float over its end, so the content never runs under them.
 * With children it is also the window's left edge (a narrow window, its sidebar in a drawer): they
 * start it, after macOS's traffic lights.
 */
export const CaptionStrip: React.FC<{ children?: React.ReactNode }> = ({ children }) => (children
  ? (
    <Group {...CAPTION_ROW} h={TOP_ROW_HEIGHT} wrap="nowrap" gap={6} pl={captionPad('left', 'left', 8)} style={{ flexShrink: 0 }}>
      {children}
    </Group>
  )
  : <Box {...CAPTION_ROW} h={TOP_ROW_HEIGHT} style={{ flexShrink: 0 }} />);

export interface ToolbarIconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** A toggle: shown pressed while on. Omitted for a plain button. */
  active?: boolean;
}

/**
 * Forwards its ref and any other props to the button, so it can be a `Menu.Target` (the menu puts
 * its `aria-haspopup`/`aria-expanded` and its click on the button itself).
 */
export const ToolbarIconButton = React.forwardRef<
  HTMLButtonElement,
  ToolbarIconButtonProps & Omit<React.ComponentPropsWithoutRef<'button'>, keyof ToolbarIconButtonProps | 'color' | 'style'>
>(({ icon: Icon, label, onClick, disabled, active, ...rest }, ref) => (
  <Tooltip label={label} position="bottom">
    <ActionIcon
      ref={ref}
      {...rest}
      variant={active ? 'light' : 'subtle'}
      size={30}
      radius="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon size={15} />
    </ActionIcon>
  </Tooltip>
));

ToolbarIconButton.displayName = 'ToolbarIconButton';

export interface ToolbarSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  flex?: React.CSSProperties['flex'];
  miw?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** The field a dialog opens on (Mantine's `data-autofocus`), not its first button. */
  dialogFocus?: boolean;
}

export const ToolbarSearchInput = React.forwardRef<HTMLInputElement, ToolbarSearchInputProps>(({
  value, onChange, placeholder, clearLabel, flex = 1, miw, onKeyDown, dialogFocus,
}, ref) => (
  <AppTextInput
    ref={ref}
    data-autofocus={dialogFocus || undefined}
    flex={flex}
    miw={miw}
    value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    onKeyDown={onKeyDown}
    aria-label={placeholder}
    placeholder={placeholder}
    tone="tertiary"
    size="xs"
    radius="sm"
    leftSection={<Search size={13} />}
    rightSection={value ? (
      <ActionIcon variant="subtle" size={20} onClick={() => onChange('')} aria-label={clearLabel}>
        <X size={12} />
      </ActionIcon>
    ) : null}
  />
));

ToolbarSearchInput.displayName = 'ToolbarSearchInput';

export interface ToolbarSearchButtonProps {
  label: string;
  onClick: () => void;
}

/**
 * A sidebar's search entry: an icon button that opens the search palette, its name carrying the
 * palette's shortcut. Not a field — a field-sized box at the top of the sidebar drew the clicks
 * meant for the action beside it.
 */
export const ToolbarSearchButton: React.FC<ToolbarSearchButtonProps> = ({ label, onClick }) => {
  const keys = comboLabel(useResolvedCombo('nav.quickSwitch'), isMac);
  return (
    <ToolbarIconButton
      icon={Search}
      label={keys ? `${label} (${keys})` : label}
      onClick={onClick}
      aria-haspopup="dialog"
    />
  );
};
