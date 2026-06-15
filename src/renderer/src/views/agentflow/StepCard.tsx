import React, { useCallback, useRef } from 'react';
import {
  ActionIcon, Badge, Box, Code, Group, Paper, Stack, Text, Tooltip,
} from '@mantine/core';
import { AlertTriangle, ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AppTextInput } from '../../components/AppTextInput';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { SKILL_ICON, STEP_CONFIG_EDITOR, skillHue, isDangerSkill } from './skills';
import { AvailableVarsHint, insertTokenAtCaret, type LoopVarHint } from './variableInsert';
import { validateOutputKey } from './skills/validation';
import { SKILLS_WITHOUT_OUTPUT_KEY } from '../../../../shared/flowSkillSchema';
import type { SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';

const UI_HIDDEN_OUTPUT: SkillType[] = ['clipboard', 'bot', 'loop'];

const ATOMIC_STEPS: SkillType[] = ['restart_app', 'break', 'continue', 'end_loop', 'end_if'];

// Steps that keep their config editor but need no human label (the config itself
// is the content, so a separate label field is redundant).
const LABELLESS_STEPS: SkillType[] = ['comment'];

export function stepHasOutput(step: SkillInstance): boolean {
  return !SKILLS_WITHOUT_OUTPUT_KEY.includes(step.type) && !UI_HIDDEN_OUTPUT.includes(step.type);
}

export interface StepCardProps {
  step: SkillInstance;
  index: number;
  total: number;
  flowId: string;
  prevSteps: SkillInstance[];
  flowTrigger?: TriggerConfig;
  loopVars?: LoopVarHint[];
  allPrevSteps?: SkillInstance[];
  dragHandle?: React.ReactNode;
  t: (k: string) => string;
}

export const StepCard: React.FC<StepCardProps> = ({
  step, index, total, flowId, prevSteps, flowTrigger, loopVars = [], allPrevSteps = [], dragHandle, t,
}) => {
  const { updateStep, removeStep, moveStep } = useAgentFlowStore(
    useShallow((s) => ({
      updateStep: s.updateStep,
      removeStep: s.removeStep,
      moveStep: s.moveStep,
    })),
  );
  const ConfigEditor = STEP_CONFIG_EDITOR[step.type];
  const skillLabelKey = `agentflow.skill.${step.type}` as const;

  const lastFocusedRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const handleConfigChange = useCallback((config: Record<string, string>) => {
    updateStep(flowId, step.id, { config });
  }, [flowId, step.id, updateStep]);

  const handleFocusCapture = useCallback((e: React.FocusEvent) => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      lastFocusedRef.current = el;
    }
  }, []);

  const handleInsertVar = useCallback((token: string) => {
    const el = lastFocusedRef.current;
    if (el && el.isConnected) {
      insertTokenAtCaret(el, token);
    } else {
      void navigator.clipboard?.writeText(token);
    }
  }, []);

  const outputKeyError = stepHasOutput(step)
    ? validateOutputKey(step.outputKey, prevSteps.map((s) => s.outputKey))
    : null;

  if (!ConfigEditor) {
    return (
      <Paper withBorder p="sm" radius="md" bg="var(--mantine-color-red-light)">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Group gap="xs" wrap="nowrap" align="center">
              <Badge variant="light" color="red" size="sm" leftSection={<AlertTriangle size={14} />} radius="sm">
                {t('agentflow.step.unknown')}
              </Badge>
              <Code fz="xs" c="red">{step.type}</Code>
              <Text fz="xs" c="dimmed">#{index + 1}</Text>
            </Group>
            <Tooltip label={t('agentflow.step.delete')} position="top">
              <ActionIcon variant="subtle" color="red" size="sm" onClick={() => removeStep(flowId, step.id)}>
                <Trash2 size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Text fz="xs" c="dimmed">{t('agentflow.step.unknown.hint')}</Text>
        </Stack>
      </Paper>
    );
  }

  const hue = skillHue(step.type);
  const danger = isDangerSkill(step.type);
  const atomic = ATOMIC_STEPS.includes(step.type);
  const showLabel = !atomic && !LABELLESS_STEPS.includes(step.type);

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      bg={danger ? 'color-mix(in srgb, var(--mantine-color-red-light) 50%, transparent)' : undefined}
      style={{ borderLeft: `3px solid var(--mantine-color-${hue}-filled)` }}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            {dragHandle}
            <Badge variant="light" color={hue} size="sm" leftSection={SKILL_ICON[step.type]} radius="sm">
              {t(skillLabelKey)}
            </Badge>
            <Text fz="xs" c="dimmed">#{index + 1}</Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            {stepHasOutput(step) && (
              <Code fz="xs" c="dimmed">{`{{${step.outputKey}}}`}</Code>
            )}
            <Tooltip label={t('agentflow.step.moveUp')} position="top">
              <ActionIcon variant="subtle" size="sm" disabled={index === 0} onClick={() => moveStep(flowId, step.id, 'up')}>
                <ArrowUp size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('agentflow.step.moveDown')} position="top">
              <ActionIcon variant="subtle" size="sm" disabled={index === total - 1} onClick={() => moveStep(flowId, step.id, 'down')}>
                <ArrowDown size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('agentflow.step.delete')} position="top">
              <ActionIcon variant="subtle" color="red" size="sm" onClick={() => removeStep(flowId, step.id)}>
                <Trash2 size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {!atomic && (
          <>
            {showLabel && (
              <AppTextInput
                label={t('agentflow.step.label')}
                value={step.label}
                onChange={(e) => updateStep(flowId, step.id, { label: e.currentTarget.value })}
                size="xs"
              />
            )}

            <Box onFocusCapture={handleFocusCapture}>
              <ConfigEditor step={step} onChange={handleConfigChange} t={t} />
            </Box>
            <AvailableVarsHint
              prevSteps={prevSteps}
              flowTrigger={flowTrigger}
              loopVars={loopVars}
              allPrevSteps={allPrevSteps}
              onInsert={handleInsertVar}
              t={t}
            />

            {stepHasOutput(step) && (
              <AppTextInput
                label={t('agentflow.step.outputKey')}
                description={t('agentflow.step.outputKey.hint')}
                value={step.outputKey}
                onChange={(e) => updateStep(flowId, step.id, { outputKey: e.currentTarget.value })}
                size="xs"
                error={outputKeyError ? t(`agentflow.step.outputKey.error.${outputKeyError}`) : undefined}
              />
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
};
