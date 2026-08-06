import React from 'react';
import { Box } from '@mantine/core';
import { CollapsibleContent } from './CollapsibleContent';
import { PromptBody } from './PromptBody';

export const UserBubble = React.memo<{ prompt: string; t: (key: string) => string }>(({ prompt, t }) => (
  <Box
    ml="auto"
    maw="80%"
    bg="var(--bg-secondary)"
    px={16}
    py={10}
    style={{
      borderRadius: 'var(--mantine-radius-lg)',
      border: '1px solid var(--border)',
    }}
  >
    <CollapsibleContent fadeColor="var(--bg-secondary)" t={t}>
      <PromptBody prompt={prompt} />
    </CollapsibleContent>
  </Box>
));
