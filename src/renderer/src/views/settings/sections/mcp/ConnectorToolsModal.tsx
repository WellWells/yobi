import React from 'react';
import { Stack, Text } from '@mantine/core';
import { Wrench } from 'lucide-react';
import { AppModal } from '../../../../components/AppModal';
import type { McpServerView } from '../../../../../../shared/types';

interface Props {
  server: McpServerView | null;
  onClose: () => void;
  t: (key: string) => string;
}

/** One row per tool, by the name a person reads; the instructions a server writes for the model stay out. */
export const ConnectorToolsModal: React.FC<Props> = ({ server, onClose, t }) => {
  const tools = server?.tools ?? [];
  return (
    <AppModal
      opened={server !== null}
      onClose={onClose}
      icon={<Wrench size={16} />}
      title={server?.name ?? ''}
      size="md"
    >
      <Stack gap={8}>
        {tools.map((tool) => (
          <Text key={tool.name} fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">
            {tool.title || tool.name}
          </Text>
        ))}
        {tools.length === 0 && (
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.mcp.tools.empty')}</Text>
        )}
      </Stack>
    </AppModal>
  );
};
