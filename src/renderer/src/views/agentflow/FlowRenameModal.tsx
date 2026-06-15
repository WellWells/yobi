import React, { useEffect, useState } from 'react';
import { Button, Group, Modal, Stack } from '@mantine/core';
import { AppTextInput } from '../../components/AppTextInput';
import { AppButton } from '../../components/AppButton';

interface FlowRenameModalProps {
  open: boolean;
  initialName: string;
  t: (k: string) => string;
  onClose: () => void;
  onRename: (name: string) => void;
}

export const FlowRenameModal: React.FC<FlowRenameModalProps> = ({
  open, initialName, t, onClose, onRename,
}) => {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    onRename(trimmed);
    onClose();
  };

  return (
    <Modal opened={open} onClose={onClose} title={t('agentflow.renameFlow')} centered size="sm" zIndex={200}>
      <Stack gap="md">
        <AppTextInput
          data-autofocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t('agentflow.flowName.placeholder')}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="xs" onClick={onClose}>{t('dialog.cancel')}</Button>
          <AppButton size="xs" disabled={!trimmed} onClick={submit}>{t('common.save')}</AppButton>
        </Group>
      </Stack>
    </Modal>
  );
};
