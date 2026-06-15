import React, { useCallback, useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import { AppTextarea } from '../../components/AppTextarea';
import { AppButton } from '../../components/AppButton';
import type { FlowGenerationResult } from '../../../../shared/types';

interface FlowGenerateModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onGenerate: (description: string) => Promise<FlowGenerationResult>;
}

export const FlowGenerateModal: React.FC<FlowGenerateModalProps> = ({
  open, t, onClose, onGenerate,
}) => {
  const [description, setDescription] = useState('');

  const handleGenerate = useCallback(() => {
    const desc = description.trim();
    if (!desc) return;
    void onGenerate(desc).catch(() => { });
    setDescription('');
    onClose();
  }, [description, onGenerate, onClose]);

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={t('agentflow.generate.modal.title')}
      centered
      size="md"
      zIndex={200}
    >
      <Stack gap="md">
        <Text fz="sm" fw={600}>{t('agentflow.generate.description.label')}</Text>
        <AppTextarea
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          placeholder={t('agentflow.generate.description.placeholder')}
          autosize
          minRows={4}
          maxRows={10}
          resize="vertical"
        />
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <AppButton
            variant="filled"
            size="xs"
            leftSection={<Sparkles size={14} />}
            disabled={!description.trim()}
            onClick={handleGenerate}
          >
            {t('agentflow.generate.button')}
          </AppButton>
        </Group>
      </Stack>
    </Modal>
  );
};
