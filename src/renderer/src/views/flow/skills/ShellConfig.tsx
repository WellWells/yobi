import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { hostPlatform } from '../../../utils/hostPlatform';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { hiddenShellCharacter } from '../../../../../shared/shellHiddenCharacter';
import type { SkillConfigProps } from './types';

const IS_WINDOWS = hostPlatform === 'win32';
const IS_MAC = hostPlatform === 'darwin';

/** The login shell (`$SHELL`), which the runner uses when `shell` is blank or `auto`. */
const SYSTEM_SHELL = 'auto';

/** `current` is listed too when it is a shell path the list does not have (a hand-edited fish). */
function shellOptions(t: (k: string) => string, current: string): { value: string; label: string }[] {
  if (IS_WINDOWS) {
    return [
      { value: 'cmd', label: 'cmd' },
      { value: 'powershell', label: 'PowerShell' },
    ];
  }
  const shells = IS_MAC
    ? [{ value: '/bin/zsh', label: 'zsh' }, { value: '/bin/bash', label: 'bash' }]
    : [{ value: '/bin/bash', label: 'bash' }, { value: '/bin/zsh', label: 'zsh' }];
  const options = [
    { value: SYSTEM_SHELL, label: t('flow.skill.shell.shell.system') },
    ...shells,
    { value: '/bin/sh', label: 'sh (POSIX)' },
  ];
  return options.some((o) => o.value === current) ? options : [...options, { value: current, label: current }];
}

/** The shell the runner (`execShell`) picks, read the same way, older `windowsShell`/`unixShell` included. */
function resolveShell(config: Record<string, string>): string {
  if (IS_WINDOWS) return (config.shell ?? config.windowsShell ?? 'cmd').toLowerCase() === 'powershell' ? 'powershell' : 'cmd';
  const selected = config.shell ?? config.unixShell;
  return selected && selected !== SYSTEM_SHELL ? selected : SYSTEM_SHELL;
}

/** The login shell is stored as a blank `shell`, without the older key it would fall back to. */
function withShell(config: Record<string, string>, value: string): Record<string, string> {
  if (value !== SYSTEM_SHELL) return { ...config, shell: value };
  const next: Record<string, string> = { ...config, shell: '' };
  delete next.unixShell;
  return next;
}

export const ShellConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const command = step.config.command ?? '';
  const hidden = hiddenShellCharacter(command);
  const shell = resolveShell(step.config);
  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.shell.command')}
        placeholder={t('flow.skill.shell.command.placeholder')}
        value={command}
        onChange={(e) => onChange({ ...step.config, command: e.currentTarget.value })}
        autosize
        minRows={1}
        maxRows={8}
        size="sm"
        mono
      />
      {hidden && (
        <Text fz="xs" c="var(--mantine-color-warning)" data-shell-hidden="">
          {fillTemplate(t('flow.skill.shell.command.hidden'), { code: hidden })}
        </Text>
      )}
      <SelectDropdown
        label={t('flow.skill.shell.shell')}
        description={IS_WINDOWS ? t('flow.skill.shell.shell.hint') : undefined}
        options={shellOptions(t, shell)}
        value={shell}
        onChange={(value) => onChange(withShell(step.config, value))}
        size="sm"
      />
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.shell.behavior')}</Text>
    </Stack>
  );
};
