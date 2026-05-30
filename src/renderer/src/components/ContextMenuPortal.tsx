// src/renderer/src/components/ContextMenuPortal.tsx
// Reusable context menu rendered at a fixed screen position.
// Eliminates the 0x0 anchor hack and duplicated global-listener pattern.
import React, { useEffect } from 'react';
import { Box, Menu } from '@mantine/core';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuPortalProps {
  position: ContextMenuPosition | null;
  onClose: () => void;
  children: React.ReactNode;
}

export const ContextMenuPortal: React.FC<ContextMenuPortalProps> = ({
  position,
  onClose,
  children,
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
      style={{ zIndex: 2000 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Menu opened withinPortal={false} position="bottom-start" offset={0} zIndex={2000}>
        <Menu.Target><Box w={0} h={0} /></Menu.Target>
        <Menu.Dropdown>{children}</Menu.Dropdown>
      </Menu>
    </Box>
  );
};
