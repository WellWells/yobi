import React, { useState } from 'react';
import { Alert, Group, Stack, Text } from '@mantine/core';
import { Trash2, TriangleAlert } from 'lucide-react';
import { AppButton } from './AppButton';
import { secretApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useSecretFailures, useSecretHealthStore } from '../store/secretHealthStore';
import type { SecretFailure, SecretScope } from '../../../shared/types';

interface Props {
  /** Scopes this section owns; failures outside them belong to someone else's alert. */
  scopes: SecretScope[];
  /** Turns an id into a name the user recognises — MCP knows its servers, the store does not. */
  resolveLabel?: (failure: SecretFailure) => string;
}

function failureKey(failure: SecretFailure): string {
  return `${failure.scope} ${failure.id} ${failure.field}`;
}

export const SecretHealthAlert: React.FC<Props> = ({ scopes, resolveLabel }) => {
  const { t } = useI18nStore();
  const keyState = useSecretHealthStore((state) => state.keyState);
  const encryptionAvailable = useSecretHealthStore((state) => state.encryptionAvailable);
  const failures = useSecretFailures(...scopes);
  const [removing, setRemoving] = useState('');

  if (failures.length === 0) return null;

  const handleRemove = async (failure: SecretFailure): Promise<void> => {
    setRemoving(failureKey(failure));
    await secretApi.deleteBroken({ scope: failure.scope, id: failure.id, field: failure.field });
    setRemoving('');
  };

  const body = !encryptionAvailable
    ? 'secret.alert.bodyUnavailable'
    : (keyState === 'rotated' ? 'secret.alert.bodyRotated' : 'secret.alert.body');

  return (
    <Alert color="red" icon={<TriangleAlert size={16} />} title={t('secret.alert.title')} mb={12}>
      <Stack gap={8}>
        <Text fz="var(--font-size-sm)" lh={1.6}>{t(body)}</Text>

        <Stack gap={4}>
          {failures.map((failure) => (
            <Group key={failureKey(failure)} justify="space-between" align="center" wrap="nowrap" gap={12}>
              <Text fz="var(--font-size-sm)" fw={600} truncate>
                {resolveLabel?.(failure) || failure.label || t(`secret.item.${failure.scope}.${failure.field}`)}
              </Text>
              {/*
                Hidden while the keychain is unreachable: that failure is usually temporary, so
                offering to delete would destroy a secret that is about to come back on its own.
              */}
              {encryptionAvailable && (
                <AppButton
                  variant="subtle"
                  color="red"
                  size="compact-xs"
                  leftSection={<Trash2 size={13} />}
                  loading={removing === failureKey(failure)}
                  onClick={() => { void handleRemove(failure); }}
                >
                  {t('secret.alert.remove')}
                </AppButton>
              )}
            </Group>
          ))}
        </Stack>

        {encryptionAvailable && (
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('secret.alert.removeHint')}</Text>
        )}
      </Stack>
    </Alert>
  );
};
