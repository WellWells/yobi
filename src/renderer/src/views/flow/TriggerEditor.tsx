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
import { findTriggerConflicts } from '../../../../shared/flowIssues';
import { readsOwnerData } from '../../../../shared/botCommandAccess';
import { useFlowIssues } from '../../hooks/useFlowIssues';
import { HotkeyRecorder } from './HotkeyRecorder';
import { CommandTriggerFields } from './CommandTriggerFields';
import { ScheduleFields } from './ScheduleFields';
import { SystemTriggerFields } from './SystemTriggerFields';
import { FileTriggerFields } from './FileTriggerFields';

const INLINE_CARD = {
  background: 'var(--mantine-color-default)',
  borderRadius: 'var(--mantine-radius-md)',
  border: '1px solid var(--mantine-color-default-border)',
} as const;

interface TriggerConfigFormProps {
  value: TriggerConfig;
  onChange: (trigger: TriggerConfig) => void;
  t: (k: string) => string;
  conflicts?: FlowIssue[];
  allowManual?: boolean;
  showBotCompoundHint?: boolean;
  soleTrigger?: boolean;
  /** The flow reads the owner's own data (decides how a bot command without a mode reads). */
  ownerData?: boolean;
  /** The app cannot find the flow's watched folder right now. */
  folderMissing?: boolean;
}

const TriggerConfigForm: React.FC<TriggerConfigFormProps> = ({
  value, onChange, t, conflicts, allowManual = true, showBotCompoundHint = false, soleTrigger = false, ownerData = false,
  folderMissing = false,
}) => {
  const patch = useCallback((p: Partial<TriggerConfig>) => {
    const next = { ...value, ...p };
    onChange(next.type === 'cron' ? normalizeCronTrigger(next) : next);
  }, [value, onChange]);

  const triggerOptions = useMemo(() => {
    const opts = [
      { value: 'hotkey', label: t('flow.trigger.hotkey') },
      { value: 'cron', label: t('flow.trigger.cron') },
      { value: 'system', label: t('flow.trigger.system') },
      { value: 'file', label: t('flow.trigger.file') },
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
          <ScheduleFields value={value} patch={patch} t={t} soleTrigger={soleTrigger} />
        </Box>
      )}

      {value.type === 'system' && (
        <SystemTriggerFields value={value} patch={patch} t={t} cardStyle={INLINE_CARD} />
      )}

      {value.type === 'file' && (
        <FileTriggerFields value={value} patch={patch} t={t} folderMissing={folderMissing} cardStyle={INLINE_CARD} />
      )}

      {value.type === 'bot' && (
        <CommandTriggerFields
          kind="bot"
          value={value}
          patch={patch}
          t={t}
          conflicts={conflicts}
          showBotCompoundHint={showBotCompoundHint}
          cardStyle={INLINE_CARD}
          ownerData={ownerData}
        />
      )}

      {value.type === 'chat' && (
        <CommandTriggerFields
          kind="chat"
          value={value}
          patch={patch}
          t={t}
          conflicts={conflicts}
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
  const ownerData = readsOwnerData(flow.steps);
  const folderMissing = issues.some((issue) => issue.kind === 'watchFolderMissing');

  return (
    <Stack gap="md">
      <TriggerConfigForm
        value={flow.trigger}
        onChange={(next) => updateTrigger(flow.id, next)}
        t={t}
        conflicts={findTriggerConflicts(issues, flow.trigger)}
        showBotCompoundHint={hasNonBotTrigger}
        soleTrigger={extraTriggers.length === 0}
        ownerData={ownerData}
        folderMissing={folderMissing}
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
                conflicts={findTriggerConflicts(issues, tr)}
                allowManual={false}
                showBotCompoundHint={hasNonBotTrigger}
                ownerData={ownerData}
                folderMissing={folderMissing}
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
