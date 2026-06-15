import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

const NONE = 'none';
const DESTRUCTIVE = new Set(['shutdown', 'restart', 'logout']);
const ACTIONS = ['shutdown', 'restart', 'logout', 'sleep', 'lock', 'hibernate'] as const;

export const PowerConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const action = step.config.action ?? '';
  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('agentflow.skill.power.action')}
        description={t('agentflow.skill.power.action.hint')}
        options={[
          { value: NONE, label: t('agentflow.skill.power.action.none') },
          ...ACTIONS.map((a) => ({ value: a, label: t(`agentflow.skill.power.action.${a}`) })),
        ]}
        value={action || NONE}
        onChange={(value) => onChange({ ...step.config, action: value === NONE ? '' : value })}
        size="sm"
      />
      {DESTRUCTIVE.has(action) && (
        <Group gap={6} align="flex-start" wrap="nowrap">
          <AlertTriangle size={13} color="var(--mantine-color-red-6)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Text fz="xs" c="red.6">{t('agentflow.skill.power.warning')}</Text>
        </Group>
      )}
    </Stack>
  );
};
