import React from 'react';
import { Box, Text } from '@mantine/core';

interface ExtraBlockProps {
  heading: string;
  content: string;
  MarkdownRenderer: React.ComponentType<{ children: string }>;
}

export const ExtraBlock = React.memo<ExtraBlockProps>(({ heading, content, MarkdownRenderer }) => (
  <Box mb={12}>
    <Text style={{
      fontSize: 'var(--font-size-base)',
      fontWeight: 600,
      color: 'var(--text-muted)',
      marginBottom: 6,
      borderLeft: '2px solid var(--border)',
      paddingLeft: 8,
    }}>
      {heading}
    </Text>
    <Box className="md-content" style={{ fontSize: 'var(--font-size-md)' }}>
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </Box>
  </Box>
));

