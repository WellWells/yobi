import React, { useCallback, useMemo } from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Plus, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../../store/useFlowStore';
import { normalizeCronTrigger } from '../../../../shared/flowSchedule';
import { AppButton } from '../../components/AppButton';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';
import { GroupHeader } from '../../components/GroupHeader';
import type { FlowDefinition, TriggerConfig, TriggerType } from '../../../../shared/types';
import type { FlowIssue } from '../../../../shared/flowIssues';
import { findTriggerConflict } from '../../../../shared/flowIssues';
import { useFlowIssues } from '../../hooks/useFlowIssues';
import { HotkeyRecorder } from './HotkeyRecorder';
import { CommandTriggerFields } from './CommandTriggerFields';
import { ScheduleFields } from './ScheduleFields';

const INLINE_CARD = {
  background: 'var(--mantine-color-default)',
  borderRadius: 'var(--mantine-radius-md)',
  border: '1px solid var(--mantine-color-default-border)',
} as const;

interface TriggerConfigFormProps {
  value: TriggerConfig;
  onChange: (trigger: TriggerConfig) => void;
  t: (k: string) => string;
  conflict?: FlowIssue;
  allowManual?: boolean;
  showBotCompoundHint?: boolean;
}

const TriggerConfigForm: React.FC<TriggerConfigFormProps> = ({
  value, onChange, t, conflict, allowManual = true, showBotCompoundHint = false,
}) => {
  const patch = useCallback((p: Partial<TriggerConfig>) => {
    const next = { ...value, ...p };
    onChange(next.type === 'cron' ? normalizeCronTrigger(next) : next);
  }, [value, onChange]);

  const triggerOptions = useMemo(() => {
    const opts = [
      { value: 'hotkey', label: t('flow.trigger.hotkey') },
      { value: 'cron', label: t('flow.trigger.cron') },
      { value: 'bot', label: t('flow.trigger.bot') },
      { value: 'chat', label: t('flow.trigger.chat') },
    ];
    if (allowManual) opts.unshift({ value: 'manual', label: t('flow.trigger.manual') });
    return opts;
  }, [t, allowManual]);

  return (
    <Stack gap="sm">
      <AppSegmentedControl
        value={value.type}
        options={triggerOptions}
        onChange={(v) => patch({ type: v as TriggerType })}
        size="sm"
      />

      {value.type === 'hotkey' && (
        <Box pt="xs">
          <HotkeyRecorder
            value={value.keys ?? ''}
            onChange={(keys) => patch({ keys })}
            t={t}
          />
        </Box>
      )}

      {value.type === 'cron' && (
        <Box p="sm" style={INLINE_CARD}>
          <ScheduleFields value={value} patch={patch} t={t} />
        </Box>
      )}

      {value.type === 'bot' && (
        <CommandTriggerFields
          kind="bot"
          value={value}
          patch={patch}
          t={t}
          conflict={conflict}
          showBotCompoundHint={showBotCompoundHint}
          cardStyle={INLINE_CARD}
        />
      )}

      {value.type === 'chat' && (
        <CommandTriggerFields
          kind="chat"
          value={value}
          patch={patch}
          t={t}
          conflict={conflict}
          cardStyle={INLINE_CARD}
        />
      )}
    </Stack>
  );
};

export interface TriggerEditorProps {
  flow: FlowDefinition;
  t: (k: string) => string;
}

export const TriggerEditor: React.FC<TriggerEditorProps> = ({ flow, t }) => {
  const { updateTrigger, addExtraTrigger, updateExtraTrigger, removeExtraTrigger } = useFlowStore(
    useShallow((s) => ({
      updateTrigger: s.updateTrigger,
      addExtraTrigger: s.addExtraTrigger,
      updateExtraTrigger: s.updateExtraTrigger,
      removeExtraTrigger: s.removeExtraTrigger,
    })),
  );
  const extraTriggers = flow.extraTriggers ?? [];
  const hasNonBotTrigger = [flow.trigger, ...extraTriggers].some((tr) => tr.type !== 'bot');
  // Edits land in the store before they are saved, so this tracks the field live.
  const issues = useFlowIssues().get(flow.id) ?? [];

  return (
    <Stack gap="md">
      <TriggerConfigForm
        value={flow.trigger}
        onChange={(next) => updateTrigger(flow.id, next)}
        t={t}
        conflict={findTriggerConflict(issues, flow.trigger)}
        showBotCompoundHint={hasNonBotTrigger}
      />

      <Box>
        <GroupHeader label={t('flow.trigger.additional')} />
        <Stack gap="sm">
          {extraTriggers.map((tr, i) => (
            <Box key={i} p="sm" style={{ ...INLINE_CARD, background: 'var(--mantine-color-bg-tertiary)' }}>
              <Group justify="space-between" align="center" mb="xs" wrap="nowrap">
                <Text fz="xs" fw={600} c="dimmed">{`${t('flow.trigger.additional')} ${i + 1}`}</Text>
                <Tooltip label={t('flow.trigger.removeTrigger')} position="left">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    aria-label={t('flow.trigger.removeTrigger')}
                    onClick={() => removeExtraTrigger(flow.id, i)}
                  >
                    <Trash2 size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <TriggerConfigForm
                value={tr}
                onChange={(next) => updateExtraTrigger(flow.id, i, next)}
                t={t}
                conflict={findTriggerConflict(issues, tr)}
                allowManual={false}
                showBotCompoundHint={hasNonBotTrigger}
              />
            </Box>
          ))}

          <AppButton
            variant="default"
            size="xs"
            leftSection={<Plus size={14} />}
            onClick={() => addExtraTrigger(flow.id)}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('flow.trigger.addTrigger')}
          </AppButton>
        </Stack>
      </Box>
    </Stack>
  );
};
