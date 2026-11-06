import React from 'react';
import { ActionIcon, Box, Group, Image, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { FileText, X } from 'lucide-react';
import { formatByteSize } from '../../utils/byteSize';

const CHIP_MAX_WIDTH = 220;

export interface AttachmentChipItem {
  id: string;
  name: string;
  size?: number;
  previewUrl?: string;
  /** Where it is on this computer: with `onOpen`, the chip is a button. */
  path?: string;
}

interface AttachmentChipsProps {
  attachments: readonly AttachmentChipItem[];
  onRemove?: (id: string) => void;
  removeLabel?: string;
  onOpen?: (path: string) => void;
  onOpenMenu?: (path: string, event: React.MouseEvent) => void;
}

export const AttachmentChips: React.FC<AttachmentChipsProps> = ({
  attachments,
  onRemove,
  removeLabel,
  onOpen,
  onOpenMenu,
}) => {
  if (attachments.length === 0) return null;

  return (
    <Group gap={8} wrap="wrap">
      {attachments.map((attachment) => {
        const { path } = attachment;
        const chip = (
          <Group
            gap={8}
            wrap="nowrap"
            px={8}
            py={6}
            bg="var(--mantine-color-default)"
            style={{
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-md)',
              maxWidth: CHIP_MAX_WIDTH,
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
        );
        return (
          <Tooltip
            key={attachment.id}
            label={attachment.size === undefined
              ? attachment.name
              : `${attachment.name} · ${formatByteSize(attachment.size)}`}
            position="top"
          >
            {path && onOpen ? (
              <UnstyledButton
                onClick={() => onOpen(path)}
                onContextMenu={(event: React.MouseEvent) => onOpenMenu?.(path, event)}
                style={{ maxWidth: CHIP_MAX_WIDTH }}
              >
                {chip}
              </UnstyledButton>
            ) : chip}
          </Tooltip>
        );
      })}
    </Group>
  );
};
