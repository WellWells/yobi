import React, { useMemo } from 'react';
import { Stack, Text } from '@mantine/core';
import { splitQuotedPrompt } from '../../utils/composerQuotes';

interface PromptBodyProps {
  prompt: string;
  fw?: number;
}

const TEXT_STYLE = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' } as const;

export const PromptBody = React.memo<PromptBodyProps>(({ prompt, fw }) => {
  const { quotes, message } = useMemo(() => splitQuotedPrompt(prompt), [prompt]);

  const body = message ? (
    <Text
      className="selectable"
      fz="var(--font-size-md)"
      lh={1.7}
      fw={fw}
      c="var(--text-primary)"
      style={TEXT_STYLE}
    >
      {message}
    </Text>
  ) : null;

  if (quotes.length === 0) return body;

  return (
    <Stack gap={8}>
      {quotes.map((quote, index) => (
        <Text
          key={`${index}-${quote.slice(0, 24)}`}
          className="selectable"
          pl={10}
          fz="var(--font-size-base)"
          lh={1.6}
          c="var(--text-muted)"
          style={{ ...TEXT_STYLE, borderLeft: '2px solid var(--border)' }}
        >
          {quote}
        </Text>
      ))}
      {body}
    </Stack>
  );
});
