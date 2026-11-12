import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { PathInput } from '../../../components/PathInput';
import { hostPlatform } from '../../../utils/hostPlatform';
import type { SkillConfigProps } from './types';

const IS_WINDOWS = hostPlatform === 'win32';

/** A path the runner starts as written, without looking it up on PATH. */
export function isAbsoluteProgramPath(path: string, platform: string = hostPlatform): boolean {
  return platform === 'win32' ? /^(?:[a-z]:[\\/]|\\\\)/i.test(path) : path.startsWith('/');
}

/** A path that is a `{{…}}` value somewhere: what it becomes is known only when the step runs. */
function holdsVariable(path: string): boolean {
  return /\{\{[^}]+\}\}/.test(path);
}

export const RunConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const path = (step.config.path ?? '').trim();
  const lookedUp = path !== '' && !holdsVariable(path) && !isAbsoluteProgramPath(path);
  const script = IS_WINDOWS && /\.(bat|cmd)$/i.test(path);
  // Windows starts on programs; macOS and Linux have no extension for one.
  const filters = IS_WINDOWS
    ? [
        { name: t('flow.skill.run.filter.programs'), extensions: ['exe', 'bat', 'cmd'] },
        { name: t('flow.skill.run.filter.all'), extensions: ['*'] },
      ]
    : undefined;
  return (
    <Stack gap="xs">
      <PathInput
        label={t('flow.skill.run.path')}
        placeholder={t('flow.skill.run.path.placeholder')}
        browseLabel={t('flow.path.browse')}
        filters={filters}
        value={step.config.path ?? ''}
        onChange={(next) => onChange({ ...step.config, path: next })}
        size="sm"
      />
      {lookedUp && (
        <Text fz="xs" c="var(--mantine-color-warning)" data-run-relative="">{t('flow.skill.run.path.relative')}</Text>
      )}
      {script && (
        <Text fz="xs" c="var(--text-muted)" data-run-console="">{t('flow.skill.run.path.console')}</Text>
      )}
      <AppTextInput
        label={t('flow.skill.run.args')}
        placeholder={t('flow.skill.run.args.placeholder')}
        value={step.config.args ?? ''}
        onChange={(e) => onChange({ ...step.config, args: e.currentTarget.value })}
        size="sm"
        mono
      />
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.run.hint')}</Text>
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.run.quoting')}</Text>
    </Stack>
  );
};
