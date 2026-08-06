import React from 'react';
import { Box } from '@mantine/core';
import { McpServersCard } from './McpServersCard';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useMcpServers } from '../hooks/useMcpServers';

type McpServers = ReturnType<typeof useMcpServers>;

interface Props {
  mcp: McpServers;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'connectors') => boolean;
  sectionGap: number;
}

export const McpSection: React.FC<Props> = ({ mcp, t, showSection, sectionGap }) => (
  <Box display={showSection(TAG_SETS.mcp, 'connectors') ? 'block' : 'none'}>
    <McpServersCard mcp={mcp} t={t} sectionGap={sectionGap} />
  </Box>
);
