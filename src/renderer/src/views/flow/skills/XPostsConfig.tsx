import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { BookmarkCheck, Trash2 } from 'lucide-react';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ipcEvents, xPostsApi } from '../../../api/electronApi';
import { isValidXAccountListOrVar } from './validation';
import { XSignInNotice } from './XSignInNotice';
import type { SkillConfigProps } from './types';

export const XPostsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const accounts = step.config.accounts ?? '';
  const accountsError = !isValidXAccountListOrVar(accounts);
  const perAccount = step.config.perAccount ?? '5';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  useEffect(() => {
    void xPostsApi.hasCheckpoint(step.id).then(setHasCheckpoint);
    return ipcEvents.onFlowExecutionEnded(() => {
      void xPostsApi.hasCheckpoint(step.id).then(setHasCheckpoint);
    });
  }, [step.id]);

  const handleClearCheckpoint = useCallback(async () => {
    await xPostsApi.clearCheckpoint(step.id);
    setHasCheckpoint(false);
  }, [step.id]);

  return (
    <Stack gap="xs">
      <XSignInNotice limit="posts" t={t} />

      <AppTextarea
        label={t('flow.skill.x_posts.accounts')}
        placeholder={t('flow.skill.x_posts.accounts.placeholder')}
        value={accounts}
        onChange={(e) => onChange({ ...step.config, accounts: e.currentTarget.value })}
        autosize
        minRows={3}
        maxRows={8}
        resize="vertical"
        mono
        error={accountsError ? t('flow.skill.x_posts.accounts.error') : undefined}
      />

      <Text fz="xs" c="dimmed">{t('flow.skill.x_posts.accounts.hint')}</Text>

      <AppNumberInput
        label={t('flow.skill.x_posts.perAccount')}
        value={perAccount}
        onChange={(v) => onChange({ ...step.config, perAccount: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">{t('flow.skill.x_posts.hint')}</Text>

      {hasCheckpoint && (
        <Group gap="xs" align="center">
          <Badge variant="light" color="var(--mantine-color-success)" size="sm" leftSection={<BookmarkCheck size={12} />}>
            {t('flow.skill.x_posts.stateActive')}
          </Badge>
        </Group>
      )}

      <Button
        variant="light"
        color="red"
        size="xs"
        leftSection={<Trash2 size={14} />}
        onClick={() => void handleClearCheckpoint()}
        disabled={!hasCheckpoint}
      >
        {t('flow.skill.x_posts.clearState')}
      </Button>

      <Text fz="xs" c="dimmed">
        {t('flow.skill.x_posts.outputHint').replaceAll('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
