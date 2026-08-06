import React from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { KeyRound } from 'lucide-react';
import { AppModal } from '../AppModal';
import { AppButton } from '../AppButton';
import { PROVIDER_LABELS } from '../../../../shared/types';
import type { LoginRequiredProvider } from '../../../../shared/types';
import { Z_MODAL } from '../../config/zLayers';

interface LoginRequiredDialogProps {
  provider: LoginRequiredProvider | null;
  t: (key: string) => string;
  onCancel: () => void;
  onConfirm: (provider: LoginRequiredProvider) => void;
}

export const LoginRequiredDialog: React.FC<LoginRequiredDialogProps> = ({
  provider, t, onCancel, onConfirm,
}) => {
  const label = provider ? PROVIDER_LABELS[provider] : '';

  return (
    <AppModal
      opened={provider !== null}
      onClose={onCancel}
      title={t('chat.model.loginRequired.title').replace('{{provider}}', label)}
      icon={<KeyRound size={16} />}
      size="sm"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        <Text fz="var(--font-size-md)" c="var(--text-secondary)" lh={1.6}>
          {t('chat.model.loginRequired.body').replace('{{provider}}', label)}
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="xs" onClick={onCancel}>
            {t('dialog.cancel')}
          </Button>
          <AppButton
            size="xs"
            leftSection={<KeyRound size={14} />}
            onClick={() => { if (provider) onConfirm(provider); }}
          >
            {t('chat.model.loginRequired.confirm')}
          </AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
};
