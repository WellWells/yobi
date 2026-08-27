import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { Wrench } from 'lucide-react';
import { AppModal } from '../../../../components/AppModal';
import type { McpServerView } from '../../../../../../shared/types';

interface Props {
  server: McpServerView | null;
  onClose: () => void;
  t: (key: string) => string;
}

export const ConnectorToolsModal: React.FC<Props> = ({ server, onClose, t }) => (
  <AppModal
    opened={server !== null}
    onClose={onClose}
    icon={<Wrench size={16} />}
    title={server?.name ?? ''}
    size="lg"
  >
    <Stack gap={10}>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
        {t('settings.mcp.tools.hint')}
      </Text>
      {(server?.tools ?? []).map((tool) => (
        <Box key={tool.name}>
          <Text fz="var(--font-size-sm)" fw={600} c="var(--text-primary)" ff="monospace">
            {tool.name}
          </Text>
          {tool.description && (
            <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>{tool.description}</Text>
          )}
        </Box>
      ))}
      {(server?.tools ?? []).length === 0 && (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.mcp.tools.empty')}</Text>
      )}
    </Stack>
  </AppModal>
);
