import React, { useMemo, useState } from 'react';
import { Divider, Group, Menu, Text } from '@mantine/core';
import { Check, Globe, MessageSquare, Waypoints, X } from 'lucide-react';
import type { ChatMode } from '../../config/chatModes';
import { renderConnectorIcon } from '../../config/connectorIcons';
import { findCatalogEntry } from '../../../../shared/mcpCatalog';
import type { KeywordCandidate } from '../../../../shared/connectorKeywords';
import { ComposerPill } from './ComposerPill';

interface ModeDropdownProps {
  /** Derived, never picked: what the current capabilities add up to. Shown, not chosen. */
  value: ChatMode;
  web: boolean;
  onToggleWeb: () => void;
  /** Every connector the user could disclose, already filtered to the agent-enabled ones. */
  connectors: KeywordCandidate[];
  activeConnectorIds: readonly string[];
  onToggleConnector: (id: string) => void;
  t: (key: string) => string;
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
  web,
  onToggleWeb,
  connectors,
  activeConnectorIds,
  onToggleConnector,
  t,
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

  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position="top-start"
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
          accent={anythingActive}
          onClick={() => setOpen((prev) => !prev)}
        />
      </Menu.Target>

      <Menu.Dropdown>
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
                  leftSection={renderConnectorIcon(findCatalogEntry(connector.url), 15)}
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
