import React, { useCallback, useEffect, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ipcEvents, xPostsApi } from '../../../api/electronApi';
import { firstBadXAccountLine } from './validation';
import { XSignInNotice } from './XSignInNotice';
import { CheckpointRow } from './CheckpointRow';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { X_POSTS_MAX_PER_RUN } from '../../../../../shared/flowFeedCaps';

export const XPostsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const accounts = step.config.accounts ?? '';
  const badLine = firstBadXAccountLine(accounts);
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
        description={t('flow.skill.x_posts.accounts.hint')}
        placeholder={t('flow.skill.x_posts.accounts.placeholder')}
        value={accounts}
        onChange={(e) => onChange({ ...step.config, accounts: e.currentTarget.value })}
        autosize
        minRows={3}
        maxRows={8}
        resize="vertical"
        mono
        error={badLine > 0 ? fillTemplate(t('flow.skill.x_posts.accounts.error'), { line: String(badLine) }) : undefined}
      />

      <AppNumberInput
        label={t('flow.skill.x_posts.perAccount')}
        description={fillTemplate(t('flow.skill.x_posts.perAccount.desc'), { max: String(X_POSTS_MAX_PER_RUN) })}
        value={perAccount}
        onChange={(v) => onChange({ ...step.config, perAccount: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <CheckpointRow
        label={t('flow.skill.x_posts.checkpoint')}
        status={hasCheckpoint ? t('flow.skill.x_posts.stateActive') : t('flow.skill.x_posts.stateEmpty')}
        resetLabel={t('flow.skill.x_posts.clearState')}
        hasCheckpoint={hasCheckpoint}
        onReset={() => void handleClearCheckpoint()}
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.x_posts.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
