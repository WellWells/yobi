import React, { useMemo } from 'react';
import { Stack, Text } from '@mantine/core';
import { splitQuotedPrompt } from '../../utils/composerQuotes';

interface PromptBodyProps {
  prompt: string;
  /** The side-by-side layout sets its question in medium; the bubble leaves it regular. */
  fw?: number;
}

const TEXT_STYLE = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' } as const;

/**
 * A sent prompt, with any passage quoted from an answer shown as a quote rather than as
 * the `>` characters it is stored with. The composer hid that syntax on the way in, so
 * the transcript has no business showing it on the way out.
 */
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
