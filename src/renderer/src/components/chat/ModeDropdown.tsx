import React, { useMemo, useState } from 'react';
import { Divider, Group, Menu, Text } from '@mantine/core';
import { BookLock, Check, ChevronRight, Files, Globe, Library, MessageSquare, Plug, Waypoints, X } from 'lucide-react';
import type { ChatMode } from '../../config/chatModes';
import { renderCandidateIcon } from '../../config/connectorIcons';
import type { KeywordCandidate } from '../../../../shared/connectorKeywords';
import { ComposerPill } from './ComposerPill';
import { MenuChoiceItem } from './MenuChoiceItem';
import { composerMenuPosition, type MenuDirection } from './composerMenuDirection';
import { fillTemplate } from '../../../../shared/fillTemplate';

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
  /** Answers from the attached knowledge bases alone; the row shows only while one is attached. */
  knowledgeOnly?: boolean;
  onSetKnowledgeOnly?: (on: boolean) => void;
  /** Within it, how many documents the user limited it to (picked on the base's page); 0 = whole bases. */
  knowledgeFileCount?: number;
  /** Lifts that limit: the whole bases again, still knowledge base only. */
  onWholeKnowledge?: () => void;
  t: (key: string) => string;
  menuDirection: MenuDirection;
}

const MENU_WIDTH = 300;
const CONNECTOR_LIST_STYLE = { width: 220, maxHeight: 320, overflowY: 'auto' } as const;
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

interface CandidateSubmenuProps {
  icon: React.ReactNode;
  title: string;
  clearLabel: string;
  items: KeywordCandidate[];
  activeIds: readonly string[];
  onToggle: (id: string) => void;
  menuDirection: MenuDirection;
  /** A row of the list's own, under the items and above "remove all" (the knowledge bases' "only"). */
  extra?: React.ReactNode;
}

/** One list one level down (connectors, knowledge bases): its count when any is picked, and "remove all" last. */
const CandidateSubmenu: React.FC<CandidateSubmenuProps> = ({ icon, title, clearLabel, items, activeIds, onToggle, menuDirection, extra }) => {
  if (items.length === 0) return null;
  const active = items.filter((item) => activeIds.includes(item.id));
  return (
    <Menu.Sub position={menuDirection === 'up' ? 'right-end' : 'right-start'}>
      <Menu.Sub.Target>
        <Menu.Sub.Item
          leftSection={icon}
          rightSection={
            <Group gap={6} wrap="nowrap">
              {active.length > 0 && (
                <Text span fz="var(--font-size-sm)" c="var(--mantine-color-accent-text)">
                  {active.length}
                </Text>
              )}
              <ChevronRight size={14} color="var(--mantine-color-dimmed)" />
            </Group>
          }
        >
          <Text fz="var(--font-size-md)" fw={active.length > 0 ? 600 : 400} lh={1.3}>
            {title}
          </Text>
        </Menu.Sub.Item>
      </Menu.Sub.Target>

      <Menu.Sub.Dropdown style={CONNECTOR_LIST_STYLE}>
        {items.map((item) => {
          const isActive = activeIds.includes(item.id);
          return (
            <MenuChoiceItem
              key={item.id}
              kind="checkbox"
              checked={isActive}
              onClick={() => onToggle(item.id)}
              icon={renderCandidateIcon(item, 15)}
              iconTop
              rightSection={isActive ? <Check size={13} color="var(--mantine-color-accent-text)" /> : null}
            >
              <Text fz="var(--font-size-md)" fw={isActive ? 600 : 400} lh={1.3}>
                {item.name}
              </Text>
            </MenuChoiceItem>
          );
        })}
        {active.length > 0 && (
          <>
            <Divider my={4} color="var(--mantine-color-default-border)" />
            {extra}
            <Menu.Item leftSection={<X size={15} />} onClick={() => active.forEach((item) => onToggle(item.id))}>
              <Text fz="var(--font-size-md)" lh={1.3}>
                {clearLabel}
              </Text>
            </Menu.Item>
          </>
        )}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
};

export const ModeDropdown: React.FC<ModeDropdownProps> = ({
  value,
  onChangeMode,
  web,
  onToggleWeb,
  connectors,
  activeConnectorIds,
  onToggleConnector,
  knowledgeOnly = false,
  onSetKnowledgeOnly,
  knowledgeFileCount = 0,
  onWholeKnowledge,
  t,
  menuDirection,
}) => {
  const [open, setOpen] = useState(false);
  const active = useMemo(
    () => connectors.filter((connector) => activeConnectorIds.includes(connector.id)),
    [connectors, activeConnectorIds],
  );
  const servers = useMemo(() => connectors.filter((connector) => !connector.knowledge), [connectors]);
  const bases = useMemo(() => connectors.filter((connector) => connector.knowledge), [connectors]);
  // Knowledge base only: the bases are all the run reaches, so they are all the pill names.
  const activeNames = useMemo(
    () => (knowledgeOnly
      ? [
        ...active.filter((connector) => connector.knowledge).map((connector) => connector.name),
        ...(knowledgeFileCount > 0 ? [fillTemplate(t('chat.mode.knowledgeFiles.count'), { count: String(knowledgeFileCount) })] : []),
      ]
      : [...(web ? [t('chat.capability.web.label')] : []), ...active.map((connector) => connector.name)]),
    [knowledgeOnly, knowledgeFileCount, web, active, t],
  );
  const CurrentIcon = knowledgeOnly ? Library : value === 'agent' ? Waypoints : MessageSquare;
  // The pill names the form the send will take, because that is the part with consequences: an
  // agent send cannot continue the provider's own thread, and the user should see which one
  // they are about to get without opening the menu.
  const label = pillLabel(
    t(knowledgeOnly ? 'chat.mode.knowledgeOnly.label' : value === 'agent' ? 'chat.mode.agent.label' : 'chat.mode.chat.label'),
    activeNames,
    (count) => fillTemplate(t('chat.mode.connectors.more'), { count: String(count) }),
  );
  const onlyRow = onSetKnowledgeOnly ? (
    <MenuChoiceItem
      kind="checkbox"
      checked={knowledgeOnly}
      onClick={() => onSetKnowledgeOnly(!knowledgeOnly)}
      icon={<BookLock size={15} />}
      iconTop
      rightSection={knowledgeOnly ? <Check size={13} color="var(--mantine-color-accent-text)" /> : null}
    >
      <Text fz="var(--font-size-md)" fw={knowledgeOnly ? 600 : 400} lh={1.3}>
        {t('chat.mode.knowledgeOnly.toggle')}
      </Text>
      <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" lh={1.4} mt={2}>
        {t('chat.mode.knowledgeOnly.description')}
      </Text>
    </MenuChoiceItem>
  ) : null;
  // Picked documents on the base's page narrowed it further: one row lifts that, nothing else.
  const wholeRow = knowledgeOnly && knowledgeFileCount > 0 && onWholeKnowledge ? (
    <Menu.Item onClick={onWholeKnowledge} leftSection={<Files size={15} />}>
      <Text fz="var(--font-size-md)" lh={1.3}>{t('chat.mode.knowledgeFiles.whole')}</Text>
      <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" lh={1.4} mt={2}>
        {fillTemplate(t('chat.mode.knowledgeFiles.description'), { count: String(knowledgeFileCount) })}
      </Text>
    </Menu.Item>
  ) : null;
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
          collapsible
          onClick={() => setOpen((prev) => !prev)}
        />
      </Menu.Target>

      <Menu.Dropdown>
        {/* Agent stands on its own: it has tools without the web, and picks among every connected
            connector by itself. The rows below are optional — choosing one brings it in for sure. */}
        <MenuChoiceItem
          kind="checkbox"
          checked={agentOn}
          onClick={() => onChangeMode(agentOn ? 'chat' : 'agent')}
          icon={<Waypoints size={15} />}
          iconTop
          rightSection={agentOn ? <Check size={13} color="var(--mantine-color-accent-text)" /> : null}
        >
          <Text fz="var(--font-size-md)" fw={agentOn ? 600 : 400} lh={1.3}>
            {t('chat.mode.agent.label')}
          </Text>
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" lh={1.4} mt={2}>
            {t('chat.mode.agent.description')}
          </Text>
        </MenuChoiceItem>

        <Divider my={4} color="var(--mantine-color-default-border)" />

        <MenuChoiceItem
          kind="checkbox"
          checked={web}
          onClick={onToggleWeb}
          icon={<Globe size={15} />}
          iconTop
          rightSection={web ? <Check size={13} color="var(--mantine-color-accent-text)" /> : null}
        >
          <Text fz="var(--font-size-md)" fw={web ? 600 : 400} lh={1.3}>
            {t('chat.capability.web.label')}
          </Text>
        </MenuChoiceItem>

        {/* Both lists grow with every one the user adds, so they live one level down and scroll
            there instead of pushing the menu past the window. */}
        <CandidateSubmenu
          icon={<Plug size={15} />}
          title={t('chat.mode.connectors.title')}
          clearLabel={t('chat.mode.connectors.clear')}
          items={servers}
          activeIds={activeConnectorIds}
          onToggle={onToggleConnector}
          menuDirection={menuDirection}
        />
        <CandidateSubmenu
          icon={<Library size={15} />}
          title={t('chat.mode.knowledge.title')}
          clearLabel={t('chat.mode.knowledge.clear')}
          items={bases}
          activeIds={activeConnectorIds}
          onToggle={onToggleConnector}
          menuDirection={menuDirection}
          extra={onlyRow || wholeRow ? <>{onlyRow}{wholeRow}</> : null}
        />
      </Menu.Dropdown>
    </Menu>
  );
};
