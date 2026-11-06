import React, { useMemo } from 'react';
import { Box, Stack } from '@mantine/core';
import { readTurnAttachments } from '../../../../shared/conversationDoc';
import { CollapsibleContent } from './CollapsibleContent';
import { PromptBody } from './PromptBody';
import { TurnAttachments } from './TurnAttachments';

interface UserBubbleProps {
  prompt: string;
  t: (key: string) => string;
  attachments?: string[];
  /** Where each of them is on this computer, in the same order (`af`). */
  attachmentFiles?: string[];
}

export const UserBubble = React.memo<UserBubbleProps>(({ prompt, t, attachments, attachmentFiles }) => {
  const attached = useMemo(
    () => readTurnAttachments({ a: attachments, af: attachmentFiles }),
    [attachments, attachmentFiles],
  );

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
        {attached.length > 0 && <TurnAttachments attachments={attached} />}
        <CollapsibleContent fadeColor="var(--bg-secondary)" t={t}>
          <Box data-find-scope><PromptBody prompt={prompt} /></Box>
        </CollapsibleContent>
      </Stack>
    </Box>
  );
});

UserBubble.displayName = 'UserBubble';
