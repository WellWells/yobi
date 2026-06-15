import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Box, Flex, Stack, Text } from '@mantine/core';
import { Download } from 'lucide-react';
import type { FlowDefinition } from '../../../../shared/types';
import { parseImportedFlows } from './flowImportParser';

interface FlowDropzoneProps {
  t: (key: string) => string;
  onImport: (flows: FlowDefinition[]) => void;
  children: React.ReactNode;
}

export const FlowDropzone: React.FC<FlowDropzoneProps> = ({ t, onImport, children }) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const raw: unknown = JSON.parse(e.target?.result as string);
            const flows = parseImportedFlows(raw);
            if (flows && flows.length > 0) {
              onImport(flows);
            }
          } catch {
          }
        };
        reader.readAsText(file);
      }
    },
    [onImport],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'] },
    noClick: true,
    noKeyboard: true,
  });

  return (
    <Box
      {...getRootProps()}
      pos="relative"
      flex={1}
      style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}
    >
      <input {...getInputProps()} />
      {children}

      {isDragActive && (
        <Flex
          pos="absolute"
          inset={0}
          align="center"
          justify="center"
          style={{
            zIndex: 50,
            background: 'var(--mantine-color-accent-dim)',
            border: '2px dashed var(--mantine-color-accent)',
            borderRadius: 'var(--mantine-radius-md)',
            pointerEvents: 'none',
          }}
        >
          <Stack align="center" gap="sm">
            <Download size={40} color="var(--mantine-color-accent)" />
            <Text fw={600} fz="md" c="var(--mantine-color-accent)">
              {t('agentflow.import.drop.hint')}
            </Text>
          </Stack>
        </Flex>
      )}
    </Box>
  );
};
