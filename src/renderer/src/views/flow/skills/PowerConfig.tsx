import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { TriangleExclamationPoint } from 'lucide-react';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { hostPlatform } from '../../../utils/hostPlatform';
import type { SkillConfigProps } from './types';

const NONE = 'none';
const DESTRUCTIVE = new Set(['shutdown', 'restart', 'logout']);
const ACTIONS = ['shutdown', 'restart', 'logout', 'sleep', 'lock', 'hibernate'] as const;

/** Actions the runner has no command for on a platform (`resolvePowerCommand` returns null). */
const UNSUPPORTED: Partial<Record<string, ReadonlySet<string>>> = { darwin: new Set(['hibernate']) };

/** The actions this computer can take, plus the saved one so a step made elsewhere still shows it. */
export function powerActionChoices(saved: string, platform: string = hostPlatform): string[] {
  const unsupported = UNSUPPORTED[platform];
  return ACTIONS.filter((action) => !unsupported?.has(action) || action === saved);
}

function Warning({ text }: { text: string }): React.ReactElement {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap" data-power-notice="">
      <TriangleExclamationPoint size={13} color="var(--mantine-color-error)" style={{ marginTop: 2, flexShrink: 0 }} />
      <Text fz="xs" c="var(--mantine-color-error)">{text}</Text>
    </Group>
  );
}

export const PowerConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const action = (step.config.action ?? '').trim().toLowerCase();
  const known = action === '' || (ACTIONS as readonly string[]).includes(action);
  const unsupported = UNSUPPORTED[hostPlatform]?.has(action) ?? false;
  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('flow.skill.power.action')}
        description={t('flow.skill.power.action.hint')}
        options={[
          { value: NONE, label: t('flow.skill.power.action.none') },
          ...powerActionChoices(action).map((a) => ({ value: a, label: t(`flow.skill.power.action.${a}`) })),
        ]}
        value={known ? (action || NONE) : null}
        onChange={(value) => onChange({ ...step.config, action: value === NONE ? '' : value })}
        size="sm"
      />
      {!known && <Warning text={t('flow.skill.power.unknown')} />}
      {unsupported && <Warning text={t('flow.skill.power.unsupported')} />}
      {DESTRUCTIVE.has(action) && <Warning text={t('flow.skill.power.warning')} />}
    </Stack>
  );
};
