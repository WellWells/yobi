import React from 'react';
import { Stack } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

const IS_WINDOWS = navigator.platform.toLowerCase().includes('win');
const IS_MAC = navigator.platform.toLowerCase().includes('mac');

// Shell options are determined once at module load based on the current OS.
const SHELL_OPTIONS = IS_WINDOWS
  ? [
      { value: 'cmd', label: 'cmd' },
      { value: 'powershell', label: 'PowerShell' },
    ]
  : IS_MAC
  ? [
      { value: '/bin/zsh', label: 'zsh' },
      { value: '/bin/bash', label: 'bash' },
      { value: '/bin/sh', label: 'sh (POSIX)' },
    ]
  : [
      { value: '/bin/bash', label: 'bash' },
      { value: '/bin/zsh', label: 'zsh' },
      { value: '/bin/sh', label: 'sh (POSIX)' },
    ];

const DEFAULT_SHELL = IS_WINDOWS ? 'cmd' : IS_MAC ? '/bin/zsh' : '/bin/bash';

// Read the effective shell from config, supporting the legacy windowsShell/unixShell fields.
function resolveShell(config: Record<string, string>): string {
  return config.shell ?? config.windowsShell ?? config.unixShell ?? DEFAULT_SHELL;
}

export const ShellConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => (
  <Stack gap="xs">
    <SelectDropdown
      label={t('agentflow.skill.shell.shell')}
      description={t('agentflow.skill.shell.shell.hint')}
      options={SHELL_OPTIONS}
      value={resolveShell(step.config)}
      onChange={(value) => onChange({ ...step.config, shell: value })}
      size="sm"
    />
    <AppTextInput
      label={t('agentflow.skill.shell.command')}
      placeholder={t('agentflow.skill.shell.command.placeholder')}
      value={step.config.command ?? ''}
      onChange={(e) => onChange({ ...step.config, command: e.currentTarget.value })}
      size="sm"
    />
  </Stack>
);
