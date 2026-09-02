import React, { useCallback } from 'react';
import { Box } from '@mantine/core';
import { ConnectorGallery } from './mcp/ConnectorGallery';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useMcpServers } from '../hooks/useMcpServers';
import type { SecretFailure } from '../../../../../shared/types';

type McpServers = ReturnType<typeof useMcpServers>;

interface Props {
  mcp: McpServers;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'connectors') => boolean;
  sectionGap: number;
}

export const McpSection: React.FC<Props> = ({ mcp, t, showSection, sectionGap }) => {
  // The token store only knows server ids; the readable name lives here.
  const resolveLabel = useCallback(
    (failure: SecretFailure) => mcp.servers.find((server) => server.id === failure.id)?.name ?? '',
    [mcp.servers],
  );

  return (
    <Box display={showSection(TAG_SETS.mcp, 'connectors') ? 'block' : 'none'}>
      <SecretHealthAlert scopes={['mcp']} resolveLabel={resolveLabel} />
      <ConnectorGallery mcp={mcp} t={t} sectionGap={sectionGap} />
    </Box>
  );
};
