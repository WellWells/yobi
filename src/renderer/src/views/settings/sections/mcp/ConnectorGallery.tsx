import React, { useMemo, useState } from 'react';
import { Box, Chip, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { Plug, Plus, Search } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput } from '../../../../components/AppTextInput';
import { WebDialog } from '../../../../components/WebDialog';
import { BuiltinConnectorCard } from './BuiltinConnectorCard';
import { ConnectorCard } from './ConnectorCard';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorToolsModal } from './ConnectorToolsModal';
import { ThunderbirdSetup } from './ThunderbirdSetup';
import { XSignInRow } from './XSignInRow';
import { builtinTile, buildTiles, matchesFilter, matchesQuery } from './connectorTiles';
import { MCP_CATEGORIES } from '../../../../../../shared/mcpCatalog';
import { BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_X_SERVER_ID, THUNDERBIRD_UNAVAILABLE_ERROR } from '../../../../../../shared/builtinConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../../../../../shared/types';
import type { useMcpServers } from '../../hooks/useMcpServers';
import type { McpServerView } from '../../../../../../shared/types';
import { connectorGrant } from '../../../../../../shared/botPermissions';
import { anyBotEnabled, whoCanUse, whoCanUseText } from '../botPermissionsView';
import type { BotRoster } from '../botPermissionsView';

type McpServers = ReturnType<typeof useMcpServers>;

interface Props {
  mcp: McpServers;
  roster: BotRoster;
  t: (key: string) => string;
  sectionGap: number;
}

export const ConnectorGallery: React.FC<Props> = ({ mcp, roster, t, sectionGap }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<McpServerView | null>(null);
  const [toolsFor, setToolsFor] = useState<string | null>(null);

  const tiles = useMemo(() => buildTiles(mcp.servers, t), [mcp.servers, t]);
  const visible = useMemo(
    () => tiles.filter((tile) => matchesFilter(tile, filter) && matchesQuery(tile, query)),
    [tiles, filter, query],
  );
  // Read-only: who may use each connector through the bots. Shown only while a bot is on.
  const botAccessFor = (serverId: string | undefined): string | undefined => {
    if (!serverId || !anyBotEnabled(roster)) return undefined;
    return whoCanUseText(whoCanUse(roster, connectorGrant(serverId)), 'connector', t);
  };
  const builtinBotAccess = (id: string): string | undefined => (
    mcp.servers.some((server) => server.id === id) ? botAccessFor(id) : undefined
  );
  const builtinShown = (id: string, titleKey: string, descKey: string): boolean => {
    const tile = builtinTile(id, mcp.servers, t(titleKey), t(descKey));
    return matchesFilter(tile, filter) && matchesQuery(tile, query);
  };
  const showLine = builtinShown(BUILTIN_LINE_SERVER_ID, 'settings.mcp.line.title', 'settings.mcp.line.desc');
  const showThunderbird = builtinShown(BUILTIN_THUNDERBIRD_SERVER_ID, 'settings.mcp.thunderbird.title', 'settings.mcp.thunderbird.desc');
  const showX = builtinShown(BUILTIN_X_SERVER_ID, 'settings.mcp.x.title', 'settings.mcp.x.desc');
  const anyBuiltinShown = showLine || showThunderbird || showX;
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
            <Chip value="open" size="xs" variant="light">{t('settings.mcp.filter.open')}</Chip>
            {MCP_CATEGORIES.map((category) => (
              <Chip key={category} value={category} size="xs" variant="light">
                {t(`settings.mcp.category.${category}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>

        {mcp.error && !mcp.form && (
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" mb={10}>{mcp.error}</Text>
        )}

        <Stack gap={10} mb={10} display={anyBuiltinShown ? 'flex' : 'none'}>
          <Box display={showLine ? 'block' : 'none'}>
            <BuiltinConnectorCard
              mcp={mcp}
              t={t}
              id={BUILTIN_LINE_SERVER_ID}
              title={t('settings.mcp.line.title')}
              description={t('settings.mcp.line.desc')}
              toggleLabel={t('settings.mcp.line.toggle')}
              onOpenTools={setToolsFor}
              botAccess={builtinBotAccess(BUILTIN_LINE_SERVER_ID)}
            />
          </Box>
          <Box display={showThunderbird ? 'block' : 'none'}>
            <BuiltinConnectorCard
              mcp={mcp}
              t={t}
              id={BUILTIN_THUNDERBIRD_SERVER_ID}
              title={t('settings.mcp.thunderbird.title')}
              description={t('settings.mcp.thunderbird.desc')}
              toggleLabel={t('settings.mcp.thunderbird.toggle')}
              onOpenTools={setToolsFor}
              botAccess={builtinBotAccess(BUILTIN_THUNDERBIRD_SERVER_ID)}
              waitingError={THUNDERBIRD_UNAVAILABLE_ERROR}
              setup={<ThunderbirdSetup t={t} />}
            />
          </Box>
          <Box display={showX ? 'block' : 'none'}>
            <BuiltinConnectorCard
              mcp={mcp}
              t={t}
              id={BUILTIN_X_SERVER_ID}
              title={t('settings.mcp.x.title')}
              description={t('settings.mcp.x.desc')}
              toggleLabel={t('settings.mcp.x.toggle')}
              onOpenTools={setToolsFor}
              botAccess={builtinBotAccess(BUILTIN_X_SERVER_ID)}
              footer={<XSignInRow t={t} />}
            />
          </Box>
        </Stack>

        {visible.length === 0 ? (!anyBuiltinShown && (
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.mcp.empty')}</Text>
        )) : (
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing={10} verticalSpacing={10}>
            {visible.map((tile) => (
              <ConnectorCard
                key={tile.key}
                entry={tile.entry}
                server={tile.server}
                name={tile.name}
                description={tile.description}
                botAccess={botAccessFor(tile.server?.id)}
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
