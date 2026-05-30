// src/renderer/src/views/agentflow/FlowTemplatesModal.tsx
// Modal for selecting and loading built-in flow templates.
import React from 'react';
import { Badge, Box, Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { FlowDefinition } from '../../../../shared/types';
import { FLOW_TEMPLATES } from './examples';

interface FlowTemplatesModalProps {
  open: boolean;
  t: (key: string) => string;
  existingFlowNames: string[];
  onClose: () => void;
  onImport: (flows: FlowDefinition[]) => void;
}

export const FlowTemplatesModal: React.FC<FlowTemplatesModalProps> = ({
  open, t, onClose, onImport,
}) => (
  <Modal
    opened={open}
    onClose={onClose}
    title={t('agentflow.templates')}
    centered
    size="sm"
    zIndex={200}
  >
    <Stack gap="sm">
      {FLOW_TEMPLATES.map((tpl) => (
        <Box
          key={tpl.key}
          p="md"
          style={{
            background: 'var(--mantine-color-bg-tertiary)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Stack gap={6}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Text fz="sm" fw={600}>{t(tpl.titleKey)}</Text>
                <Text fz="xs" c="dimmed">{t(tpl.descKey)}</Text>
              </Stack>
              <Badge size="xs" variant="light">{t('agentflow.templates.badge')}</Badge>
            </Group>
            <Button
              size="xs"
              variant="default"
              onClick={() => { onImport([tpl.build(t)]); }}
            >
              {t('agentflow.templates.load')}
            </Button>
          </Stack>
        </Box>
      ))}
    </Stack>
  </Modal>
);
