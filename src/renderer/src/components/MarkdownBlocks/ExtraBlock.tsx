import React from 'react';
import { Box, Text } from '@mantine/core';
import { READING_TEXT_STYLE } from '../../styles/readingText';

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
    <Box className="md-content" style={READING_TEXT_STYLE}>
      <MarkdownRenderer>{content}</MarkdownRenderer>
    </Box>
  </Box>
));

