import React from 'react';
import { ActionIcon, Box, Group, Stack, Text } from '@mantine/core';
import { Quote, X } from 'lucide-react';

interface QuoteChipsProps {
  quotes: string[];
  onRemove: (index: number) => void;
  removeLabel: string;
}

/** A quote is context, not the message: one line, so it never crowds out the question. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export const QuoteChips: React.FC<QuoteChipsProps> = ({ quotes, onRemove, removeLabel }) => {
  if (quotes.length === 0) return null;

  return (
    <Stack gap={6}>
      {quotes.map((quote, index) => (
        <Group
          key={`${index}-${quote.slice(0, 24)}`}
          gap={10}
          wrap="nowrap"
          px={10}
          py={7}
          bg="var(--bg-tertiary)"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
        >
          <Box c="var(--text-muted)" style={{ display: 'flex', flexShrink: 0 }}>
            <Quote size={13} />
          </Box>
          <Text
            fz="var(--font-size-base)"
            c="var(--text-secondary)"
            truncate="end"
            title={oneLine(quote)}
            style={{ flex: 1, minWidth: 0 }}
          >
            {oneLine(quote)}
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={removeLabel}
            onClick={() => onRemove(index)}
            style={{ flexShrink: 0 }}
          >
            <X size={13} />
          </ActionIcon>
        </Group>
      ))}
    </Stack>
  );
};
