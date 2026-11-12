import React, { useEffect, useState } from 'react';
import { Button, Group, Stack } from '@mantine/core';
import { Pencil } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { RenameInput } from '../../components/RenameInput';
import { AppButton } from '../../components/AppButton';
import { Z_MODAL } from '../../config/zLayers';
import { flowAiSource } from '../../../../shared/aiName';
import type { FlowDefinition } from '../../../../shared/types';

interface FlowRenameModalProps {
  open: boolean;
  initialName: string;
  /** The flow being renamed: what the ✨ names it from. */
  flow: FlowDefinition | null;
  t: (k: string) => string;
  onClose: () => void;
  onRename: (name: string) => void;
}

export const FlowRenameModal: React.FC<FlowRenameModalProps> = ({
  open, initialName, flow, t, onClose, onRename,
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
    <AppModal opened={open} onClose={onClose} title={t('flow.renameFlow')} icon={<Pencil size={16} />} size="sm" zIndex={Z_MODAL}>
      <Stack gap="md">
        <RenameInput
          data-autofocus
          value={name}
          onChange={setName}
          ai={flow ? flowAiSource(flow) : null}
          placeholder={t('flow.flowName.placeholder')}
          onCommit={submit}
          onCancel={onClose}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="xs" onClick={onClose}>{t('dialog.cancel')}</Button>
          <AppButton size="xs" disabled={!trimmed} onClick={submit}>{t('common.save')}</AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
};
