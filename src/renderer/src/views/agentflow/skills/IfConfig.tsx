import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

const IF_OPERATORS = ['is_true', 'is_false', 'equals', 'not_equals', 'contains', 'is_empty'] as const;
const OPERATORS_WITHOUT_RIGHT = new Set<string>(['is_true', 'is_false', 'is_empty']);

export const IfConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const operator = step.config.operator ?? 'is_true';
  const showRight = !OPERATORS_WITHOUT_RIGHT.has(operator);

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.if.left')}
        placeholder={t('agentflow.skill.if.left.placeholder')}
        value={step.config.left ?? ''}
        onChange={(e) => onChange({ ...step.config, left: e.currentTarget.value })}
        mono
        size="sm"
      />
      <SelectDropdown
        label={t('agentflow.skill.if.operator')}
        options={IF_OPERATORS.map((op) => ({ value: op, label: t(`agentflow.skill.if.op.${op}`) }))}
        value={operator}
        onChange={(value) => onChange({ ...step.config, operator: value })}
        size="sm"
      />
      {showRight && (
        <AppTextInput
          label={t('agentflow.skill.if.right')}
          placeholder={t('agentflow.skill.if.right.placeholder')}
          value={step.config.right ?? ''}
          onChange={(e) => onChange({ ...step.config, right: e.currentTarget.value })}
          size="sm"
        />
      )}
      <Text fz="xs" c="dimmed">{t('agentflow.skill.if.hint')}</Text>
    </Stack>
  );
};
