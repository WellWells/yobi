import React, { useMemo, useState } from 'react';
import { Divider, Group, Menu, Text } from '@mantine/core';
import { Check, Globe, MessageSquare, Waypoints, X } from 'lucide-react';
import type { ChatMode } from '../../config/chatModes';
import { renderServerIcon } from '../../config/connectorIcons';
import type { KeywordCandidate } from '../../../../shared/connectorKeywords';
import { ComposerPill } from './ComposerPill';
import { composerMenuPosition, type MenuDirection } from './composerMenuDirection';

interface ModeDropdownProps {
  /** Agent when switched on by itself or implied by the web or a connector; otherwise chat. */
  value: ChatMode;
  /** The Agent row: on switches Agent on by itself; off returns to chat and clears the capabilities. */
  onChangeMode: (mode: ChatMode) => void;
  web: boolean;
  onToggleWeb: () => void;
  /** Every connector the user could disclose, already filtered to the agent-enabled ones. */
  connectors: KeywordCandidate[];
  activeConnectorIds: readonly string[];
  onToggleConnector: (id: string) => void;
  t: (key: string) => string;
  menuDirection: MenuDirection;
}

const MENU_WIDTH = 300;
/** Past this the pill would out-grow the composer footer, so the rest become a count. */
const NAMES_IN_PILL = 2;

function pillLabel(
  base: string,
  names: string[],
  overflowLabel: (count: number) => string,
): string {
  if (names.length === 0) return base;
  const shown = names.slice(0, NAMES_IN_PILL).join(', ');
  const rest = names.length - NAMES_IN_PILL;
  return `${base} · ${shown}${rest > 0 ? ` ${overflowLabel(rest)}` : ''}`;
}

export const ModeDropdown: React.FC<ModeDropdownProps> = ({
  value,
  onChangeMode,
  web,
  onToggleWeb,
  connectors,
  activeConnectorIds,
  onToggleConnector,
  t,
  menuDirection,
}) => {
  const [open, setOpen] = useState(false);
  const active = useMemo(
    () => connectors.filter((connector) => activeConnectorIds.includes(connector.id)),
    [connectors, activeConnectorIds],
  );
  const activeNames = useMemo(
    () => [...(web ? [t('chat.capability.web.label')] : []), ...active.map((connector) => connector.name)],
    [web, active, t],
  );
  const CurrentIcon = value === 'agent' ? Waypoints : MessageSquare;
  // The pill names the form the send will take, because that is the part with consequences: an
  // agent send cannot continue the provider's own thread, and the user should see which one
  // they are about to get without opening the menu.
  const label = pillLabel(
    t(value === 'agent' ? 'chat.mode.agent.label' : 'chat.mode.chat.label'),
    activeNames,
    (count) => t('chat.mode.connectors.more').replace('{{count}}', String(count)),
  );
  const anythingActive = web || active.length > 0;
  const agentOn = value === 'agent';

  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position={composerMenuPosition(menuDirection, 'start')}
      offset={6}
      withinPortal
      zIndex={20}
      closeOnItemClick={false}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          width: MENU_WIDTH,
          maxWidth: '100%',
        },
        itemSection: {
          alignSelf: 'flex-start',
          marginTop: 2,
        },
      }}
    >
      <Menu.Target>
        <ComposerPill
          icon={<CurrentIcon size={14} />}
          label={label}
          open={open}
          accent={agentOn}
          onClick={() => setOpen((prev) => !prev)}
        />
      </Menu.Target>

      <Menu.Dropdown>
        {/* Agent stands on its own: it has tools without the web, and picks among every connected
            connector by itself. The rows below are optional — choosing one brings it in for sure. */}
        <Menu.Item
          onClick={() => onChangeMode(agentOn ? 'chat' : 'agent')}
          leftSection={<Waypoints size={15} />}
          rightSection={agentOn ? <Check size={13} color="var(--mantine-color-accent)" /> : null}
          style={{
            background: agentOn ? 'var(--mantine-color-accent-dim)' : undefined,
            color: agentOn ? 'var(--mantine-color-accent)' : undefined,
          }}
        >
          <Text fz="var(--font-size-md)" fw={agentOn ? 600 : 400} lh={1.3}>
            {t('chat.mode.agent.label')}
          </Text>
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" lh={1.4} mt={2}>
            {t('chat.mode.agent.description')}
          </Text>
        </Menu.Item>

        <Divider my={4} color="var(--mantine-color-default-border)" />

        <Menu.Label>
          <Group gap={6} justify="space-between" wrap="nowrap">
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)">
              {t('chat.mode.connectors.title')}
            </Text>
            {anythingActive && (
              <Text
                component="span"
                fz="var(--font-size-sm)"
                c="var(--mantine-color-dimmed)"
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                onClick={() => {
                  active.forEach((connector) => onToggleConnector(connector.id));
                  if (web) onToggleWeb();
                }}
              >
                <X size={11} />
                {t('chat.mode.connectors.clear')}
              </Text>
            )}
          </Group>
        </Menu.Label>

        <Menu.Item
          onClick={onToggleWeb}
          leftSection={<Globe size={15} />}
          rightSection={web ? <Check size={13} color="var(--mantine-color-accent)" /> : null}
          style={{
            background: web ? 'var(--mantine-color-accent-dim)' : undefined,
            color: web ? 'var(--mantine-color-accent)' : undefined,
          }}
        >
          <Text fz="var(--font-size-md)" fw={web ? 600 : 400} lh={1.3}>
            {t('chat.capability.web.label')}
          </Text>
        </Menu.Item>

        {connectors.length > 0 && (
          <>
            <Divider my={4} color="var(--mantine-color-default-border)" />
            {connectors.map((connector) => {
              const isActive = activeConnectorIds.includes(connector.id);
              return (
                <Menu.Item
                  key={connector.id}
                  onClick={() => onToggleConnector(connector.id)}
                  leftSection={renderServerIcon(connector.url, 15)}
                  rightSection={isActive ? <Check size={13} color="var(--mantine-color-accent)" /> : null}
                  style={{
                    background: isActive ? 'var(--mantine-color-accent-dim)' : undefined,
                    color: isActive ? 'var(--mantine-color-accent)' : undefined,
                  }}
                >
                  <Text fz="var(--font-size-md)" fw={isActive ? 600 : 400} lh={1.3}>
                    {connector.name}
                  </Text>
                </Menu.Item>
              );
            })}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
};
