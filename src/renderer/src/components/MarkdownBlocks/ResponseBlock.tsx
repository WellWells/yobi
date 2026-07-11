import React from 'react';
import { Box } from '@mantine/core';

interface ResponseBlockProps {
  response: string;
  MarkdownRenderer: React.ComponentType<{ children: string }>;
}

export const ResponseBlock = React.memo<ResponseBlockProps>(({ response, MarkdownRenderer }) => (
  <Box
    className="md-content md-response"
    style={{
      flex: 1,
      fontSize: 'var(--font-size-md)',
      lineHeight: 1.75,
      color: 'var(--text-primary)',
    }}
  >
    <MarkdownRenderer>{response}</MarkdownRenderer>
  </Box>
));

