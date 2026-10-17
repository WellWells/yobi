import React from 'react';
import { Modal, Button, Group, Text } from '@mantine/core';

interface WebDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
  /** Above the default only when it opens over another dialog. */
  zIndex?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export const WebDialog: React.FC<WebDialogProps> = ({
  open,
  title,
  description,
  confirmText,
  cancelText,
  danger = false,
  zIndex = 60,
  onConfirm,
  onCancel,
}) => (
  <Modal
    opened={open}
    onClose={onCancel}
    title={title}
    centered
    size="md"
    zIndex={zIndex}
    styles={{
      content: {
        background: 'var(--bg-secondary)',
        border: `1px solid ${danger ? 'color-mix(in srgb, var(--mantine-color-error) 50%, transparent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
      },
      header: {
        background: 'var(--bg-secondary)',
        fontWeight: 700,
        fontSize: 'var(--font-size-xl)',
        color: 'var(--text-primary)',
      },
      body: {
        background: 'var(--bg-secondary)',
      },
    }}
  >
    <Text fz="var(--font-size-sm)" c="var(--text-secondary)" style={{ lineHeight: 1.6, marginBottom: 14 }}>
      {description}
    </Text>
    <Group justify="flex-end" gap={8}>
      <Button
        variant="default"
        onClick={onCancel}
        data-dialog-action="cancel"
      >
        {cancelText}
      </Button>
      <Button
        variant="filled"
        color={danger ? 'red' : undefined}
        onClick={onConfirm}
        data-dialog-action="confirm"
        data-autofocus
        autoFocus
      >
        {confirmText}
      </Button>
    </Group>
  </Modal>
);

