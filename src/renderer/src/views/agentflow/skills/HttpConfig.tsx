import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { isValidJsonOrEmpty, isValidUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const HttpConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const method = step.config.method ?? 'GET';
  const showBody = method !== 'GET' && method !== 'DELETE';
  const urlError = !isValidUrlOrVar(url);
  const headersError = !isValidJsonOrEmpty(step.config.headers ?? '');

  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('agentflow.skill.http.method')}
        options={METHODS.map((m) => ({ value: m, label: m }))}
        value={method}
        onChange={(value) => onChange({ ...step.config, method: value })}
        size="sm"
      />

      <AppTextInput
        label={t('agentflow.skill.http.url')}
        placeholder={t('agentflow.skill.http.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.browser.url.error') : undefined}
      />

      <AppTextarea
        label={t('agentflow.skill.http.headers')}
        placeholder={t('agentflow.skill.http.headers.placeholder')}
        value={step.config.headers ?? ''}
        onChange={(e) => onChange({ ...step.config, headers: e.currentTarget.value })}
        minRows={2}
        autosize
        mono
        size="sm"
        error={headersError ? t('agentflow.skill.http.headers.error') : undefined}
      />

      {showBody && (
        <AppTextarea
          label={t('agentflow.skill.http.body')}
          placeholder={t('agentflow.skill.http.body.placeholder')}
          value={step.config.body ?? ''}
          onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
          minRows={3}
          autosize
          mono
          size="sm"
        />
      )}

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
