import React from 'react';
import { Divider, NavLink, Text } from '@mantine/core';
import { Check } from 'lucide-react';
import { startsNewGroup, type ChatCommand } from '../../hooks/useChatCommands';
import { commandIcon } from '../../config/chatModes';
import { renderConnectorIcon } from '../../config/connectorIcons';
import { findCatalogEntry } from '../../../../shared/mcpCatalog';
import { ComposerSuggestList } from './ComposerSuggestList';
import styles from './ComposerSuggestList.module.css';

interface SlashCommandMenuProps {
  commands: ChatCommand[];
  highlightedIndex: number;
  onSelect: (command: ChatCommand) => void;
  onHover: (index: number) => void;
  emptyLabel: string;
  /** Flow ids already disclosed to this conversation. Picking one again is idempotent. */
  activeFlowIds: ReadonlySet<string>;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  commands, highlightedIndex, onSelect, onHover, emptyLabel, activeFlowIds,
}) => (
  <ComposerSuggestList highlightedIndex={highlightedIndex} emptyLabel={emptyLabel} isEmpty={commands.length === 0}>
    {commands.map((cmd, i) => {
      const Icon = commandIcon(cmd.flowId);
      const leftSection = cmd.connectorUrl
        ? renderConnectorIcon(findCatalogEntry(cmd.connectorUrl), 15)
        : <Icon size={15} />;
      return (
        <React.Fragment key={`${cmd.flowId}:${cmd.command}`}>
          {startsNewGroup(commands, i) && <Divider color="var(--mantine-color-default-border)" />}
          <NavLink
            data-suggest-index={i}
            className={styles.item}
            classNames={{ description: styles.description, section: styles.section }}
            active={i === highlightedIndex}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(event) => { event.preventDefault(); onSelect(cmd); }}
            leftSection={leftSection}
            rightSection={activeFlowIds.has(cmd.flowId)
              ? <Check size={13} color="var(--mantine-color-accent)" />
              : undefined}
            label={<Text fz="var(--font-size-base)" fw={600} ff="monospace">{`/${cmd.command}`}</Text>}
            description={cmd.description || undefined}
          />
        </React.Fragment>
      );
    })}
  </ComposerSuggestList>
);
