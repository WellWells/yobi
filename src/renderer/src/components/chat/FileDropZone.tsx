import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Box, Flex, Stack, Text } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';
import {
  clearInternalFileDrag,
  isInternalFileDrag,
  isLeavingWindow,
} from '../../utils/internalFileDrag';

function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isExternalFileDrag(event: { dataTransfer: DataTransfer | null }): boolean {
  return carriesFiles(event) && !isInternalFileDrag();
}

const FileDragActive = createContext(false);

/** The chat view's outer row: a file dragged over it raises every `FileDropZone` inside (import vs attach). */
export const FileDragArea: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    // A file dropped anywhere the zones do not cover must not navigate the window to it.
    const prevent = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      prevent(event);
      clearInternalFileDrag();
    };
    const onLeave = (event: DragEvent) => {
      if (isLeavingWindow(event, window.innerWidth, window.innerHeight)) clearInternalFileDrag();
    };
    // An OS drag delivers no mouse moves, and the moves before it takes over hold the button;
    // a bare move means the drag is over — the only sign left after Esc cancels it in-window.
    const onMove = (event: MouseEvent) => {
      if (event.buttons === 0) clearInternalFileDrag();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    depth.current += 1;
    setActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    if (depth.current === 0) return;
    depth.current -= 1;
    if (depth.current === 0) setActive(false);
  }, []);

  const handleDrop = useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  return (
    <FileDragActive.Provider value={active}>
      <Flex
        flex={1}
        style={{ overflow: 'hidden' }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {children}
      </Flex>
    </FileDragActive.Provider>
  );
};

interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  icon: LucideIcon;
  title: string;
  detail?: string;
  /** Take the remaining width of the row (the chat), rather than the child's own (the list). */
  grow?: boolean;
  children: React.ReactNode;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFiles, icon: Icon, title, detail, grow = false, children }) => {
  const dragActive = useContext(FileDragActive);
  const [hovered, setHovered] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    if (dragActive) return;
    depth.current = 0;
    setHovered(false);
  }, [dragActive]);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    depth.current += 1;
    setHovered(true);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback(() => {
    if (depth.current === 0) return;
    depth.current -= 1;
    if (depth.current === 0) setHovered(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    depth.current = 0;
    setHovered(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  }, [onFiles]);

  const tone = hovered ? 'var(--mantine-color-accent)' : 'var(--text-muted)';

  return (
    <Box
      pos="relative"
      style={{ display: 'flex', minWidth: 0, ...(grow ? { flex: 1 } : { flexShrink: 0 }) }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragActive && (
        <Stack
          align="center"
          justify="center"
          gap={8}
          pos="absolute"
          inset={8}
          px="md"
          data-hovered={String(hovered)}
          style={{
            zIndex: 50,
            pointerEvents: 'none',
            textAlign: 'center',
            backgroundColor: 'var(--mantine-color-body)',
            border: `2px dashed ${hovered ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default-border)'}`,
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Box c={tone} style={{ display: 'flex' }}>
            <Icon size={28} />
          </Box>
          <Text c={hovered ? tone : 'var(--mantine-color-text)'} fz="var(--font-size-md)" fw={600}>
            {title}
          </Text>
          {detail && (
            <Text c="var(--text-muted)" fz="var(--font-size-sm)">
              {detail}
            </Text>
          )}
        </Stack>
      )}
    </Box>
  );
};
