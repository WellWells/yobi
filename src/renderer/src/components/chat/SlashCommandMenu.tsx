import React from 'react';
import { Box, NavLink, Text } from '@mantine/core';
import type { ChatCommand } from '../../hooks/useChatCommands';

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
    style={{
      left: 0,
      right: 0,
      bottom: '100%',
      marginBottom: 6,
      zIndex: 200,
      border: '1px solid var(--mantine-color-default-border)',
      borderRadius: 'var(--mantine-radius-md)',
      boxShadow: 'var(--shadow-md)',
      overflow: 'hidden',
      maxHeight: 280,
      overflowY: 'auto',
    }}
  >
    {commands.length === 0 ? (
      <Text fz="var(--font-size-sm)" c="dimmed" p="sm" ta="center">{emptyLabel}</Text>
    ) : (
      commands.map((cmd, i) => (
        <NavLink
          key={`${cmd.flowId}:${cmd.command}`}
          active={i === highlightedIndex}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(event) => { event.preventDefault(); onSelect(cmd); }}
          label={<Text fz="var(--font-size-base)" fw={600} ff="monospace">{`/${cmd.command}`}</Text>}
          description={cmd.description || undefined}
        />
      ))
    )}
  </Box>
);
