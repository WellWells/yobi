import React, { useMemo, useState } from 'react';
import { Box, Chip, Group, SimpleGrid, Text } from '@mantine/core';
import { Plug, Plus, Search } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput } from '../../../../components/AppTextInput';
import { WebDialog } from '../../../../components/WebDialog';
import { ConnectorCard } from './ConnectorCard';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorToolsModal } from './ConnectorToolsModal';
import { buildTiles, matchesFilter, matchesQuery } from './connectorTiles';
import { MCP_CATEGORIES } from '../../../../../../shared/mcpCatalog';
import type { useMcpServers } from '../../hooks/useMcpServers';
import type { McpServerView } from '../../../../../../shared/types';

type McpServers = ReturnType<typeof useMcpServers>;

interface Props {
  mcp: McpServers;
  t: (key: string) => string;
  sectionGap: number;
}

export const ConnectorGallery: React.FC<Props> = ({ mcp, t, sectionGap }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<McpServerView | null>(null);
  const [toolsFor, setToolsFor] = useState<string | null>(null);

  const tiles = useMemo(() => buildTiles(mcp.servers, t), [mcp.servers, t]);
  const visible = useMemo(
    () => tiles.filter((tile) => matchesFilter(tile, filter) && matchesQuery(tile, query)),
    [tiles, filter, query],
  );
  const toolsServer = mcp.servers.find((s) => s.id === toolsFor) ?? null;
  const connectedCount = mcp.servers.filter((s) => s.status === 'connected').length;

  return (
    <Box>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Plug size={15} />} label={t('settings.mcp.title')} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={12}>
          {t('settings.mcp.hint')}
        </Text>

        <Group gap={8} wrap="nowrap" mb={10}>
          <AppTextInput
            flex={1}
            size="sm"
            placeholder={t('settings.mcp.search')}
            aria-label={t('settings.mcp.search')}
            leftSection={<Search size={14} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <AppButton variant="default" size="sm" leftSection={<Plus size={14} />} onClick={mcp.openAdd}>
            {t('settings.mcp.addCustom')}
          </AppButton>
        </Group>

        <Chip.Group value={filter} onChange={(next) => setFilter(typeof next === 'string' ? next : 'all')}>
          <Group gap={6} wrap="wrap" mb={14}>
            <Chip value="all" size="xs" variant="light">{t('settings.mcp.filter.all')}</Chip>
            <Chip value="connected" size="xs" variant="light">
              {`${t('settings.mcp.filter.connected')}${connectedCount > 0 ? ` (${connectedCount})` : ''}`}
            </Chip>
            {
}
            <Chip value="open" size="xs" variant="light">{t('settings.mcp.filter.open')}</Chip>
            {MCP_CATEGORIES.map((category) => (
              <Chip key={category} value={category} size="xs" variant="light">
                {t(`settings.mcp.category.${category}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>

        {mcp.error && !mcp.form && (
          <Text fz="var(--font-size-sm)" c="red" mb={10}>{mcp.error}</Text>
        )}

        {
}
        {visible.length === 0 ? (
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.mcp.empty')}</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing={10} verticalSpacing={10}>
            {visible.map((tile) => (
              <ConnectorCard
                key={tile.key}
                entry={tile.entry}
                server={tile.server}
                name={tile.name}
                description={tile.description}
                busy={mcp.busyId === tile.key || (tile.server ? mcp.busyId === tile.server.id : false)}
                t={t}
                onAdd={() => { void mcp.addFromCatalog(tile.entry); }}
                onConnect={() => { if (tile.server) void mcp.connect(tile.server.id); }}
                onDisconnect={() => { if (tile.server) void mcp.disconnect(tile.server.id); }}
                onEdit={() => { if (tile.server) mcp.openEdit(tile.server); }}
                onRemove={() => setConfirmDelete(tile.server ?? null)}
                onOpenTools={() => setToolsFor(tile.server?.id ?? null)}
              />
            ))}
          </SimpleGrid>
        )}
      </SectionCard>

      <ConnectorFormModal mcp={mcp} t={t} />
      <ConnectorToolsModal server={toolsServer} onClose={() => setToolsFor(null)} t={t} />

      <WebDialog
        open={confirmDelete !== null}
        title={t('settings.mcp.delete.confirm.title').replace('{{name}}', confirmDelete?.name ?? '')}
        description={t('settings.mcp.delete.confirm.detail')}
        confirmText={t('settings.mcp.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const server = confirmDelete;
          setConfirmDelete(null);
          if (server) void mcp.removeServer(server.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Box>
  );
};
