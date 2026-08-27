import React, { useMemo } from 'react';
import { Box, Stack } from '@mantine/core';
import { AttachmentChips, chipsFromNames } from './AttachmentChips';
import { CollapsibleContent } from './CollapsibleContent';
import { PromptBody } from './PromptBody';

interface UserBubbleProps {
  prompt: string;
  t: (key: string) => string;
  attachments?: string[];
}

export const UserBubble = React.memo<UserBubbleProps>(({ prompt, t, attachments }) => {
  const chips = useMemo(() => chipsFromNames(attachments ?? []), [attachments]);

  return (
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
      <Stack gap={8}>
        {chips.length > 0 && <AttachmentChips attachments={chips} />}
        <CollapsibleContent fadeColor="var(--bg-secondary)" t={t}>
          <PromptBody prompt={prompt} />
        </CollapsibleContent>
      </Stack>
    </Box>
  );
});

UserBubble.displayName = 'UserBubble';
