import React, { useEffect, useState } from 'react';
import { Menu } from '@mantine/core';
import type { FloatingPosition } from '@mantine/core';
import { writingToolsApi } from '../api/electronApi';
import { PROVIDER_DROPDOWN_MAX_HEIGHT } from '../config/models';
import { Z_POPOVER } from '../config/zLayers';
import { ModelMenuItems } from './chat/ModelMenuItems';
import { AI_MODEL_MENU_ATTR } from './renameKeys';

function stopEvent(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

interface AiModelMenuProps {
  /** The menu's first line: what the picked model will do ("Name with"). */
  menuLabel: string;
  /** A model was picked: run the request with it. */
  onPick: (providerUrl: string) => void;
  disabled?: boolean;
  position?: FloatingPosition;
  zIndex?: number;
  /** The menu closed, picked or not: a rename box takes its focus back. */
  onClose?: () => void;
  /** The target; it must take a ref (an ActionIcon, a SectionActionButton). */
  children: React.ReactElement;
}

/**
 * Which model does a one-off job (naming a conversation, flow or category): opens on hover or click,
 * and picking a model is what starts the job, so the model used is never a guess. The list is the
 * chat model menu's own; the tick is the quick-action model that writing tools and translation
 * share, which main remembers from every pick. The sub-menus render inside this dropdown, so a
 * box that saves on blur sees focus in them as focus in the menu.
 */
export const AiModelMenu: React.FC<AiModelMenuProps> = ({
  menuLabel, onPick, disabled = false, position = 'bottom-end', zIndex = Z_POPOVER, onClose, children,
}) => {
  const [opened, setOpened] = useState(false);
  // Hovered open, the menu leaves focus where it is: the user may be typing in the box beside it,
  // and Mantine's focus trap would send those keys to the menu's type-ahead (Enter there picks a
  // model). Clicked or pressed open, it takes focus so the keyboard can walk the models.
  const [clicked, setClicked] = useState(false);
  const [modelUrl, setModelUrl] = useState('');
  const target = React.cloneElement(children as React.ReactElement<{ onClick?: (event: React.MouseEvent) => void }>, {
    onClick: (event: React.MouseEvent) => {
      setClicked(true);
      (children.props as { onClick?: (event: React.MouseEvent) => void }).onClick?.(event);
    },
  });

  useEffect(() => {
    if (!opened) return undefined;
    let live = true;
    void writingToolsApi.getModel().then((url) => { if (live) setModelUrl(url); }, () => undefined);
    return () => { live = false; };
  }, [opened]);

  return (
    <Menu
      trigger="click-hover"
      openDelay={120}
      closeDelay={200}
      opened={opened}
      onChange={(next) => {
        setOpened(next);
        if (next) return;
        setClicked(false);
        onClose?.();
      }}
      trapFocus={clicked}
      disabled={disabled}
      position={position}
      offset={4}
      withinPortal
      zIndex={zIndex}
      returnFocus={false}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          minWidth: 180,
          maxHeight: PROVIDER_DROPDOWN_MAX_HEIGHT,
          overflowY: 'auto',
        },
        item: { fontSize: 'var(--font-size-md)' },
      }}
    >
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown
        {...{ [AI_MODEL_MENU_ATTR]: '' }}
        // The dropdown is portalled, but React still bubbles its events to whatever holds the
        // button — a sidebar row opens, selects or starts a drag on them, a dialog closes on
        // Escape. They are the menu's alone.
        onKeyDown={stopEvent}
        onClick={stopEvent}
        onMouseDown={stopEvent}
        onPointerDown={stopEvent}
      >
        <Menu.Label>{menuLabel}</Menu.Label>
        <ModelMenuItems
          value={modelUrl}
          onChange={(url) => {
            setModelUrl(url);
            setOpened(false);
            setClicked(false);
            onPick(url);
          }}
        />
      </Menu.Dropdown>
    </Menu>
  );
};
