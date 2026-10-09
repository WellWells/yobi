import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { Users } from 'lucide-react';

interface Props {
  text: string;
  mt?: number;
}

/**
 * The read-only "who can use this through the bots" line under a built-in command or a
 * connector card. Grants are edited in one place only, under each account in the Telegram /
 * LINE paired lists; this line just reports them.
 */
export const BotAccessCaption: React.FC<Props> = ({ text, mt }) => (
  <Group gap={6} wrap="nowrap" align="flex-start" mt={mt}>
    <Box c="dimmed" mt={3} style={{ flexShrink: 0, display: 'flex' }}><Users size={12} /></Box>
    <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>{text}</Text>
  </Group>
);
