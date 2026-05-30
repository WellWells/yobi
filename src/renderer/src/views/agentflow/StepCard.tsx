import React, { useCallback } from 'react';
import {
  ActionIcon, Badge, Box, Code, Group, Paper, Stack, Text, Tooltip,
} from '@mantine/core';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { SKILL_ICON, SKILL_COLOR, STEP_CONFIG_EDITOR } from './skills';
import type { SkillInstance, TriggerConfig } from '../../../../shared/types';

export function stepHasOutput(step: SkillInstance): boolean {
  if (step.type === 'clipboard' || step.type === 'bot' || step.type === 'comment' || step.type === 'loop') return false;
  if (step.type === 'utility') return step.config.action === 'export';
  return true;
}

const AvailableVarsHint: React.FC<{
  prevSteps: SkillInstance[];
  flowTrigger?: TriggerConfig;
  loopVars?: string[];
  t: (k: string) => string;
}> = ({ prevSteps, flowTrigger, loopVars = [], t }) => {
  const inputVar = flowTrigger?.type === 'bot'
    ? (flowTrigger.botInputVariable?.trim() || 'input')
    : undefined;

  return (
    <Group gap={6} wrap="wrap" align="center">
      <Text fz="xs" c="dimmed">{t('agentflow.availableVars')}</Text>
      <Code fz="xs" c="dimmed">{'{{clipboard}}'}</Code>
      <Code fz="xs" c="dimmed">{'{{timestamp}}'}</Code>
      {inputVar && (
        <Code fz="xs" c="teal">{`{{${inputVar}}}`}</Code>
      )}
      {flowTrigger?.type === 'bot' && (
        <>
          <Code fz="xs" c="teal">{'{{bot.triggerChatId}}'}</Code>
          <Code fz="xs" c="teal">{'{{bot.triggerUserId}}'}</Code>
        </>
      )}
      {loopVars.map((v) => (
        <React.Fragment key={v}>
          <Code fz="xs" c="orange">{`{{${v}}}`}</Code>
          <Code fz="xs" c="orange">{`{{${v}.title}}`}</Code>
          <Code fz="xs" c="orange">{`{{${v}.link}}`}</Code>
        </React.Fragment>
      ))}
      {prevSteps.map((s) => (
        <Code key={s.id} fz="xs" c="blue">{`{{${s.outputKey}}}`}</Code>
      ))}
    </Group>
  );
};

export interface StepCardProps {
  step: SkillInstance;
  index: number;
  total: number;
  flowId: string;
  prevSteps: SkillInstance[];
  flowTrigger?: TriggerConfig;
  loopVars?: string[];
  t: (k: string) => string;
}

export const StepCard: React.FC<StepCardProps> = ({
  step, index, total, flowId, prevSteps, flowTrigger, loopVars = [], t,
}) => {
  const { updateStep, removeStep, moveStep } = useAgentFlowStore();
  const ConfigEditor = STEP_CONFIG_EDITOR[step.type];
  const skillLabelKey = `agentflow.skill.${step.type}` as const;

  const handleConfigChange = useCallback((config: Record<string, string>) => {
    updateStep(flowId, step.id, { config });
  }, [flowId, step.id, updateStep]);

  return (
    <Paper withBorder p="sm" radius="md" bg={SKILL_COLOR[step.type]}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Badge variant="light" size="sm" leftSection={SKILL_ICON[step.type]} radius="sm">
              {t(skillLabelKey)}
            </Badge>
            <Text fz="xs" c="dimmed">#{index + 1}</Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            {stepHasOutput(step) && (
              <Code fz="xs" c="blue">{`{{${step.outputKey}}}`}</Code>
            )}
            <Tooltip label="Move up" position="top">
              <ActionIcon variant="subtle" size="sm" disabled={index === 0} onClick={() => moveStep(flowId, step.id, 'up')}>
                <ArrowUp size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Move down" position="top">
              <ActionIcon variant="subtle" size="sm" disabled={index === total - 1} onClick={() => moveStep(flowId, step.id, 'down')}>
                <ArrowDown size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('agentflow.deleteFlow')} position="top">
              <ActionIcon variant="subtle" color="red" size="sm" onClick={() => removeStep(flowId, step.id)}>
                <Trash2 size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <AppTextInput
          label={t('agentflow.step.label')}
          value={step.label}
          onChange={(e) => updateStep(flowId, step.id, { label: e.currentTarget.value })}
          size="xs"
        />

        <ConfigEditor step={step} onChange={handleConfigChange} t={t} />
        <AvailableVarsHint prevSteps={prevSteps} flowTrigger={flowTrigger} loopVars={loopVars} t={t} />

        {stepHasOutput(step) && (
          <AppTextInput
            label={t('agentflow.step.outputKey')}
            description={t('agentflow.step.outputKey.hint')}
            value={step.outputKey}
            onChange={(e) => updateStep(flowId, step.id, { outputKey: e.currentTarget.value })}
            size="xs"
          />
        )}
      </Stack>
    </Paper>
  );
};
