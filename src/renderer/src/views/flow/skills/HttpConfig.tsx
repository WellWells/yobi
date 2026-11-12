import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { isValidJsonObjectOrEmpty, isValidUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Methods the runner sends a body with; GET and DELETE leave it out. */
export function httpSendsBody(method: string): boolean {
  return method !== 'GET' && method !== 'DELETE';
}

export const HttpConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const method = step.config.method ?? 'GET';
  const showBody = httpSendsBody(method);
  const body = step.config.body ?? '';
  const urlError = !isValidUrlOrVar(url);
  const headersError = !isValidJsonObjectOrEmpty(step.config.headers ?? '');

  return (
    <Stack gap="xs">
      {/* Method and address are one pair, as in every API tool: five short methods fit beside the URL. */}
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Box w={104} style={{ flexShrink: 0 }}>
          <SelectDropdown
            label={t('flow.skill.http.method')}
            options={METHODS.map((m) => ({ value: m, label: m }))}
            value={method}
            onChange={(value) => onChange({ ...step.config, method: value })}
            size="sm"
            styles={{ input: { fontFamily: 'var(--font-mono)' } }}
          />
        </Box>
        <AppTextInput
          label={t('flow.skill.http.url')}
          placeholder={t('flow.skill.http.url.placeholder')}
          value={url}
          onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
          size="sm"
          mono
          style={{ flex: 1, minWidth: 0 }}
          error={urlError ? t('flow.skill.http.url.error') : undefined}
        />
      </Group>

      <AppTextarea
        label={t('flow.skill.http.headers')}
        placeholder={t('flow.skill.http.headers.placeholder')}
        value={step.config.headers ?? ''}
        onChange={(e) => onChange({ ...step.config, headers: e.currentTarget.value })}
        minRows={2}
        autosize
        mono
        size="sm"
        error={headersError ? t('flow.skill.http.headers.error') : undefined}
      />

      {showBody && (
        <AppTextarea
          label={t('flow.skill.http.body')}
          placeholder={t('flow.skill.http.body.placeholder')}
          value={body}
          onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
          minRows={3}
          autosize
          mono
          size="sm"
        />
      )}
      {!showBody && body.trim() !== '' && (
        <Text fz="xs" c="var(--mantine-color-warning)" data-http-body-unsent="">
          {fillTemplate(t('flow.skill.http.body.unsent'), { method })}
        </Text>
      )}

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.http.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
