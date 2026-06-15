import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { Upload } from 'lucide-react';

interface ChatDropZoneProps {
  onFiles: (files: File[]) => void;
  overlayLabel: string;
  children: React.ReactNode;
}

function dragHasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export const ChatDropZone: React.FC<ChatDropZoneProps> = ({ onFiles, overlayLabel, children }) => {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    const prevent = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        event.preventDefault();
      }
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  }, [onFiles]);

  return (
    <Box
      pos="relative"
      style={{ flex: 1, display: 'flex', minWidth: 0 }}
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
          gap={10}
          pos="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          style={{
            zIndex: 50,
            pointerEvents: 'none',
            backgroundColor: 'var(--mantine-color-body)',
            opacity: 0.92,
            border: '2px dashed var(--mantine-color-accent)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Box c="var(--mantine-color-accent)" style={{ display: 'flex' }}>
            <Upload size={32} />
          </Box>
          <Text c="var(--mantine-color-text)" fz="var(--font-size-md)" fw={600}>
            {overlayLabel}
          </Text>
        </Stack>
      )}
    </Box>
  );
};
