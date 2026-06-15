import React from 'react';
import { ActionIcon, Box, Group, Image, Text } from '@mantine/core';
import { FileText, X } from 'lucide-react';
import type { PromptAttachment } from '../../../../shared/types';

interface AttachmentChipsProps {
  attachments: PromptAttachment[];
  onRemove: (id: string) => void;
  removeLabel: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AttachmentChips: React.FC<AttachmentChipsProps> = ({
  attachments,
  onRemove,
  removeLabel,
}) => {
  if (attachments.length === 0) return null;

  return (
    <Group gap={8} wrap="wrap">
      {attachments.map((attachment) => (
        <Group
          key={attachment.id}
          gap={8}
          wrap="nowrap"
          px={8}
          py={6}
          bg="var(--mantine-color-default)"
          title={`${attachment.name} · ${formatSize(attachment.size)}`}
          style={{
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-md)',
            maxWidth: 220,
          }}
        >
          {attachment.previewUrl ? (
            <Image src={attachment.previewUrl} w={24} h={24} radius="sm" fit="cover" />
          ) : (
            <Box c="var(--mantine-color-dimmed)" style={{ display: 'flex', flexShrink: 0 }}>
              <FileText size={18} />
            </Box>
          )}
          <Text fz="var(--font-size-base)" truncate="end" style={{ flex: 1, minWidth: 0 }}>
            {attachment.name}
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={() => onRemove(attachment.id)}
            style={{ flexShrink: 0 }}
          >
            <X size={14} />
          </ActionIcon>
        </Group>
      ))}
    </Group>
  );
};
