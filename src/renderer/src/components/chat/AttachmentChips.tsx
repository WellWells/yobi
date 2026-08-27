import React from 'react';
import { ActionIcon, Box, Group, Image, Text, Tooltip } from '@mantine/core';
import { FileText, X } from 'lucide-react';

export interface AttachmentChipItem {
  id: string;
  name: string;
  size?: number;
  previewUrl?: string;
}

interface AttachmentChipsProps {
  attachments: readonly AttachmentChipItem[];
  onRemove?: (id: string) => void;
  removeLabel?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function chipsFromNames(names: readonly string[]): AttachmentChipItem[] {
  if (!Array.isArray(names)) return [];
  return names
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map((name, index) => ({ id: `${index}-${name}`, name }));
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
        <Tooltip
          key={attachment.id}
          label={attachment.size === undefined
            ? attachment.name
            : `${attachment.name} · ${formatSize(attachment.size)}`}
          position="top"
        >
          <Group
            gap={8}
            wrap="nowrap"
            px={8}
            py={6}
            bg="var(--mantine-color-default)"
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
            {onRemove && (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={removeLabel}
                onClick={() => onRemove(attachment.id)}
                style={{ flexShrink: 0 }}
              >
                <X size={14} />
              </ActionIcon>
            )}
          </Group>
        </Tooltip>
      ))}
    </Group>
  );
};
