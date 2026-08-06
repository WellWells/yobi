import React from 'react';
import { Box, Divider, NavLink, Text } from '@mantine/core';
import { startsNewGroup, type ChatCommand } from '../../hooks/useChatCommands';
import { commandIcon } from '../../config/chatModes';
import styles from './SlashCommandMenu.module.css';
import { Z_POPOVER } from '../../config/zLayers';

const MENU_WIDTH = 340;
const MENU_MAX_HEIGHT = 320;

interface SlashCommandMenuProps {
  commands: ChatCommand[];
  highlightedIndex: number;
  onSelect: (command: ChatCommand) => void;
  onHover: (index: number) => void;
  emptyLabel: string;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  commands, highlightedIndex, onSelect, onHover, emptyLabel,
}) => (
  <Box
    pos="absolute"
    bg="var(--mantine-color-default)"
    w={MENU_WIDTH}
    style={{
      left: 0,
      bottom: '100%',
      maxWidth: '100%',
      marginBottom: 6,
      zIndex: Z_POPOVER,
      border: '1px solid var(--mantine-color-default-border)',
      borderRadius: 'var(--mantine-radius-md)',
      boxShadow: 'var(--shadow-md)',
      overflow: 'hidden',
      maxHeight: MENU_MAX_HEIGHT,
      overflowY: 'auto',
    }}
  >
    {commands.length === 0 ? (
      <Text fz="var(--font-size-sm)" c="dimmed" p="sm" ta="center">{emptyLabel}</Text>
    ) : (
      commands.map((cmd, i) => {
        const Icon = commandIcon(cmd.flowId);
        return (
          <React.Fragment key={`${cmd.flowId}:${cmd.command}`}>
            {startsNewGroup(commands, i) && <Divider color="var(--mantine-color-default-border)" />}
            <NavLink
              className={styles.item}
              classNames={{ description: styles.description, section: styles.section }}
              active={i === highlightedIndex}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(event) => { event.preventDefault(); onSelect(cmd); }}
              leftSection={<Icon size={15} />}
              label={<Text fz="var(--font-size-base)" fw={600} ff="monospace">{`/${cmd.command}`}</Text>}
              description={cmd.description || undefined}
            />
          </React.Fragment>
        );
      })
    )}
  </Box>
);
