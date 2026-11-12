import React, { useEffect } from 'react';
import { Box, Menu } from '@mantine/core';
import { Z_CONTEXT_MENU } from '../config/zLayers';

interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuPortalProps {
  position: ContextMenuPosition | null;
  onClose: () => void;
  children: React.ReactNode;
  /** Off = focus stays where it was (a text field keeps its selection drawn); default on. */
  trapFocus?: boolean;
  dropdownRef?: React.Ref<HTMLDivElement>;
}

export const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  position,
  onClose,
  children,
  trapFocus = true,
  dropdownRef,
}) => {
  useEffect(() => {
    if (!position) return;
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [position, onClose]);

  if (!position) return null;

  return (
    <Box
      pos="fixed"
      top={position.y}
      left={position.x}
      style={{ zIndex: Z_CONTEXT_MENU }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Menu opened withinPortal={false} position="bottom-start" offset={0} zIndex={Z_CONTEXT_MENU} trapFocus={trapFocus}>
        <Menu.Target><Box w={0} h={0} /></Menu.Target>
        <Menu.Dropdown ref={dropdownRef}>{children}</Menu.Dropdown>
      </Menu>
    </Box>
  );
};
