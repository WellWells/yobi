import React, { useMemo, useState } from 'react';
import { Box, Chip, Group, SimpleGrid, Text } from '@mantine/core';
import { Plus, Search } from 'lucide-react';
import { SectionCard } from '../../components';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput } from '../../../../components/AppTextInput';
import { GroupHeader } from '../../../../components/GroupHeader';
import { WebDialog } from '../../../../components/WebDialog';
import { BuiltinConnectorCard } from './BuiltinConnectorCard';
import { ConnectorCard } from './ConnectorCard';
import { commandClashLines } from './CommandClashNotice';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorToolsModal } from './ConnectorToolsModal';
import { ThunderbirdSetup } from './ThunderbirdSetup';
import { SiteSignInRow } from './SiteSignInRow';
import { addedFirst, builtinTile, buildTiles, matchesFilter, matchesQuery } from './connectorTiles';
import { connectorBotAccess } from './connectorBotAccess';
import { MCP_CATEGORIES } from '../../../../../../shared/mcpCatalog';
import {
  BUILTIN_MAIL_SERVER_ID, BUILTIN_PTT_SERVER_ID, BUILTIN_RAIL_SERVER_ID, BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_X_SERVER_ID,
  THUNDERBIRD_UNAVAILABLE_ERROR,
} from '../../../../../../shared/builtinConnectors';
import { MailAccountSetup } from './MailAccountSetup';
import { RailKeySetup } from './RailKeySetup';
import { SITE_CONNECTOR_ROWS, siteConnectorServerId } from '../../../../../../shared/siteConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../../../../../shared/types';
import type { useMcpServers } from '../../hooks/useMcpServers';
import { useMcpCommandAssignment } from '../../../../hooks/useMcpCommands';
import type { McpServerView } from '../../../../../../shared/types';
import { BotAccessCaption } from '../BotAccessCaption';
import type { BotRoster } from '../botPermissionsView';
import { fillTemplate } from '../../../../../../shared/fillTemplate';

type McpServers = ReturnType<typeof useMcpServers>;

/** Two tiles of ~300px or more, the width the big apps give one; narrower falls back to one column. */
const TWO_TILES_FROM = '600px';
const FULL_ROW: React.CSSProperties = { gridColumn: '1 / -1' };

const FILTER_CHIP_STYLES = {
  iconWrapper: { display: 'none' },
  label: { paddingInline: 10 },
} as const;

interface Props {
  mcp: McpServers;
  roster: BotRoster;
  t: (key: string) => string;
  sectionGap: number;
}

interface BuiltinSpec {
  id: string;
  title: string;
  description: string;
  toggleLabel: string;
  waitingError?: string;
  setup?: React.ReactNode;
  footer?: React.ReactNode;
}

/** One row of the list: a built-in card or a gallery tile, already rendered. */
interface ListItem {
  key: string;
  added: boolean;
  shown: boolean;
  node: React.ReactNode;
}

export const ConnectorGallery: React.FC<Props> = ({ mcp, roster, t, sectionGap }) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<McpServerView | null>(null);
  const [toolsFor, setToolsFor] = useState<string | null>(null);

  const tiles = useMemo(() => buildTiles(mcp.servers, t), [mcp.servers, t]);
  // Read-only: who may use each connector through the bots. Shown only while a bot is on.
  const botAccess = useMemo(
    () => connectorBotAccess(roster, mcp.servers.map((server) => server.id), t),
    [roster, mcp.servers, t],
  );
  // The same assignment the chat's slash menu is built from, so a card never contradicts the menu.
  const commandAssignment = useMcpCommandAssignment();
  const commandNoticeFor = (serverId: string): string[] => commandClashLines(serverId, commandAssignment, t);
  const toolsServer = mcp.servers.find((s) => s.id === toolsFor) ?? null;
  const connectedCount = mcp.servers.filter((s) => s.status === 'connected').length;

  const builtins: BuiltinSpec[] = [
    {
      id: BUILTIN_LINE_SERVER_ID,
      title: t('settings.mcp.line.title'),
      description: t('settings.mcp.line.desc'),
      toggleLabel: t('settings.mcp.line.toggle'),
    },
    {
      id: BUILTIN_THUNDERBIRD_SERVER_ID,
      title: t('settings.mcp.thunderbird.title'),
      description: t('settings.mcp.thunderbird.desc'),
      toggleLabel: t('settings.mcp.thunderbird.toggle'),
      waitingError: THUNDERBIRD_UNAVAILABLE_ERROR,
      setup: <ThunderbirdSetup t={t} />,
    },
    {
      id: BUILTIN_X_SERVER_ID,
      title: t('settings.mcp.x.title'),
      description: t('settings.mcp.x.desc'),
      toggleLabel: t('settings.mcp.x.toggle'),
      footer: <SiteSignInRow site="x" t={t} />,
    },
    {
      id: BUILTIN_RAIL_SERVER_ID,
      title: t('settings.mcp.rail.title'),
      description: t('settings.mcp.rail.desc'),
      toggleLabel: t('settings.mcp.rail.toggle'),
      footer: <RailKeySetup t={t} />,
    },
    {
      id: BUILTIN_PTT_SERVER_ID,
      title: t('settings.mcp.ptt.title'),
      description: t('settings.mcp.ptt.desc'),
      toggleLabel: t('settings.mcp.ptt.toggle'),
    },
    {
      id: BUILTIN_MAIL_SERVER_ID,
      title: t('settings.mcp.mail.title'),
      description: t('settings.mcp.mail.desc'),
      toggleLabel: t('settings.mcp.mail.toggle'),
      footer: <MailAccountSetup t={t} />,
    },
    ...SITE_CONNECTOR_ROWS.map((row) => ({
      id: siteConnectorServerId(row.site),
      title: t(row.keys.title),
      description: t(row.keys.desc),
      toggleLabel: t(row.keys.toggle),
      footer: <SiteSignInRow site={row.site} t={t} />,
    })),
  ];

  // Built-in cards stay mounted and are hidden with `display`, as before; gallery tiles that do
  // not match are left out. Both kinds share one keyed list, so a card that moves between the
  // two parts keeps its state.
  const builtinItems: ListItem[] = builtins.map((spec) => {
    const tile = builtinTile(spec.id, mcp.servers, spec.title, spec.description);
    return {
      key: spec.id,
      added: Boolean(tile.server),
      shown: matchesFilter(tile, filter) && matchesQuery(tile, query),
      node: (
        <BuiltinConnectorCard
          mcp={mcp}
          t={t}
          id={spec.id}
          title={spec.title}
          description={spec.description}
          toggleLabel={spec.toggleLabel}
          onOpenTools={setToolsFor}
          botAccess={botAccess.captions.get(spec.id)}
          commandNotice={commandNoticeFor(spec.id)}
          waitingError={spec.waitingError}
          setup={spec.setup}
          footer={spec.footer}
        />
      ),
    };
  });
  const tileItems: ListItem[] = tiles
    .filter((tile) => matchesFilter(tile, filter) && matchesQuery(tile, query))
    .map((tile) => ({
      key: tile.key,
      added: Boolean(tile.server),
      shown: true,
      node: (
        <ConnectorCard
          entry={tile.entry}
          server={tile.server}
          name={tile.name}
          description={tile.description}
          botAccess={tile.server ? botAccess.captions.get(tile.server.id) : undefined}
          commandNotice={tile.server ? commandNoticeFor(tile.server.id) : undefined}
          busy={mcp.busyId === tile.key || (tile.server ? mcp.busyId === tile.server.id : false)}
          t={t}
          onAdd={() => { void mcp.addFromCatalog(tile.entry); }}
          onConnect={() => { if (tile.server) void mcp.connect(tile.server.id); }}
          onDisconnect={() => { if (tile.server) void mcp.disconnect(tile.server.id); }}
          onEdit={() => { if (tile.server) mcp.openEdit(tile.server); }}
          onRemove={() => setConfirmDelete(tile.server ?? null)}
          onOpenTools={() => setToolsFor(tile.server?.id ?? null)}
        />
      ),
    }));

  const { added, rest } = addedFirst([...builtinItems, ...tileItems], (item) => item.added);
  const addedShown = added.some((item) => item.shown);
  const restShown = rest.some((item) => item.shown);
  // Headers only when both parts are on screen; a single part needs no label.
  const withHeaders = addedShown && restShown;
  // The user's own connectors carry settings (keys, mailboxes, sign-in) and span the full width;
  // the catalog below them is tiles, two to a row once the column is wide enough. Both live in
  // one grid so a card that moves between the parts keeps its state.
  const row = (item: ListItem, wide: boolean): React.ReactNode => (
    <Box key={item.key} display={item.shown ? 'block' : 'none'} style={wide ? FULL_ROW : undefined}>{item.node}</Box>
  );
  const header = (key: string, label: string): React.ReactNode => (
    <Box key={key} style={FULL_ROW}><GroupHeader label={label} mb={0} /></Box>
  );
  // One flat array: React matches keys only within the same array.
  const listChildren = [
    ...(withHeaders ? [header('header-added', t('settings.mcp.group.added'))] : []),
    ...added.map((item) => row(item, true)),
    ...(withHeaders ? [header('header-more', t('settings.mcp.group.more'))] : []),
    ...rest.map((item) => row(item, false)),
  ];

  return (
    <Box>
      {/* The page title already says Connectors, so the card opens with its description. */}
      <SectionCard style={{ marginBottom: sectionGap }}>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={botAccess.summary ? 6 : 12}>
          {t('settings.mcp.hint')}
        </Text>
        {botAccess.summary && <Box mb={12}><BotAccessCaption text={botAccess.summary} /></Box>}

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

        {/* The tinted fill already marks the picked filter, so the chips drop Mantine's check mark and
            its extra padding: the whole row fits on one line instead of leaving one chip stranded. */}
        <Chip.Group value={filter} onChange={(next) => setFilter(typeof next === 'string' ? next : 'all')}>
          <Group gap={4} wrap="wrap" mb={14}>
            <Chip value="all" size="xs" variant="light" styles={FILTER_CHIP_STYLES}>{t('settings.mcp.filter.all')}</Chip>
            <Chip value="connected" size="xs" variant="light" styles={FILTER_CHIP_STYLES}>
              {`${t('settings.mcp.filter.connected')}${connectedCount > 0 ? ` (${connectedCount})` : ''}`}
            </Chip>
            <Chip value="open" size="xs" variant="light" styles={FILTER_CHIP_STYLES}>{t('settings.mcp.filter.open')}</Chip>
            {MCP_CATEGORIES.map((category) => (
              <Chip key={category} value={category} size="xs" variant="light" styles={FILTER_CHIP_STYLES}>
                {t(`settings.mcp.category.${category}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>

        {mcp.error && !mcp.form && (
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" mb={10}>{mcp.error}</Text>
        )}

        {/* Columns follow the card's own width (a container query), never the window's. */}
        <SimpleGrid type="container" cols={{ base: 1, [TWO_TILES_FROM]: 2 }} spacing={10} verticalSpacing={10}>
          {listChildren}
        </SimpleGrid>
        {!addedShown && !restShown && (
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.mcp.empty')}</Text>
        )}
      </SectionCard>

      <ConnectorFormModal mcp={mcp} t={t} />
      <ConnectorToolsModal server={toolsServer} onClose={() => setToolsFor(null)} t={t} />

      <WebDialog
        open={confirmDelete !== null}
        title={fillTemplate(t('settings.mcp.delete.confirm.title'), { name: confirmDelete?.name ?? '' })}
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
