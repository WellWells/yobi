import React from 'react';
import { Box } from '@mantine/core';
import { READING_TEXT_STYLE } from '../../styles/readingText';

interface ResponseBlockProps {
  response: string;
  MarkdownRenderer: React.ComponentType<{ children: string }>;
}

export const ResponseBlock = React.memo<ResponseBlockProps>(({ response, MarkdownRenderer }) => (
  <Box
    className="md-content md-response"
    style={{
      flex: 1,
      ...READING_TEXT_STYLE,
      lineHeight: 1.75,
      color: 'var(--text-primary)',
    }}
  >
    <MarkdownRenderer>{response}</MarkdownRenderer>
  </Box>
));

