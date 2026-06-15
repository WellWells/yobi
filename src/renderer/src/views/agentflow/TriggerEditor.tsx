import React, { useCallback, useMemo } from 'react';
import { ActionIcon, Box, Chip, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Plus, TriangleAlert, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { normalizeCronTrigger } from '../../../../shared/flowSchedule';
import { AppButton } from '../../components/AppButton';
import { AppNumberInput } from '../../components/AppNumberInput';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';
import { GroupHeader } from '../../components/GroupHeader';
import { SelectDropdown } from '../../components/SelectDropdown';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { FlowDefinition, TriggerConfig, TriggerType } from '../../../../shared/types';
import { HotkeyRecorder } from './HotkeyRecorder';
import { CommandTriggerFields } from './CommandTriggerFields';

const DAY_OPTIONS = [
  { value: '0', key: 'sun' },
  { value: '1', key: 'mon' },
  { value: '2', key: 'tue' },
  { value: '3', key: 'wed' },
  { value: '4', key: 'thu' },
  { value: '5', key: 'fri' },
  { value: '6', key: 'sat' },
] as const;

const INLINE_CARD = {
  background: 'var(--mantine-color-default)',
  borderRadius: 'var(--mantine-radius-md)',
  border: '1px solid var(--mantine-color-default-border)',
} as const;

interface TriggerConfigFormProps {
  value: TriggerConfig;
  onChange: (trigger: TriggerConfig) => void;
  t: (k: string) => string;
  allowManual?: boolean;
  showBotCompoundHint?: boolean;
}

const TriggerConfigForm: React.FC<TriggerConfigFormProps> = ({
  value, onChange, t, allowManual = true, showBotCompoundHint = false,
}) => {
  const scheduleMode = value.scheduleMode
    ?? ((value.intervalValue !== undefined || value.intervalUnit !== undefined) ? 'interval' : 'weekly');
  const intervalValue = value.intervalValue ?? 1;
  const intervalUnit = value.intervalUnit ?? 'hours';
  const weekdays = value.weekdays ?? [1, 2, 3, 4, 5];
  const scheduleHour = value.scheduleHour ?? 9;
  const scheduleMinute = value.scheduleMinute ?? 0;
  const repeatWithinDay = value.repeatWithinDay ?? false;
  const repeatEveryValue = value.repeatEveryValue ?? 1;
  const repeatEveryUnit = value.repeatEveryUnit ?? 'hours';
  const endHour = value.endHour ?? 18;
  const endMinute = value.endMinute ?? 0;

  const endTimeInvalid = repeatWithinDay
    && (endHour * 60 + endMinute) <= (scheduleHour * 60 + scheduleMinute);

  const patch = useCallback((p: Partial<TriggerConfig>) => {
    const next = { ...value, ...p };
    onChange(next.type === 'cron' ? normalizeCronTrigger(next) : next);
  }, [value, onChange]);

  const triggerOptions = useMemo(() => {
    const opts = [
      { value: 'hotkey', label: t('agentflow.trigger.hotkey') },
      { value: 'cron', label: t('agentflow.trigger.cron') },
      { value: 'bot', label: t('agentflow.trigger.bot') },
      { value: 'chat', label: t('agentflow.trigger.chat') },
    ];
    if (allowManual) opts.unshift({ value: 'manual', label: t('agentflow.trigger.manual') });
    return opts;
  }, [t, allowManual]);

  const hourOptions = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, '0') })), []);

  const minuteOptions = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, '0') })), []);

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
        <Stack gap="xs">
          <AppSegmentedControl
            value={scheduleMode}
            options={[
              { value: 'weekly', label: t('agentflow.trigger.schedule.mode.weekly') },
              { value: 'interval', label: t('agentflow.trigger.schedule.mode.interval') },
            ]}
            onChange={(v) => patch({ scheduleMode: v as 'interval' | 'weekly' })}
            size="sm"
          />

          {scheduleMode === 'interval' && (
            <Stack gap="sm" p="sm" style={INLINE_CARD}>
              <Group gap="xs" align="center" wrap="nowrap">
                <Text fz="sm" fw={600} miw={86}>{t('agentflow.trigger.schedule.runEvery')}</Text>
                <AppNumberInput
                  aria-label={t('agentflow.trigger.schedule.runEvery')}
                  min={1}
                  max={intervalUnit === 'hours' ? 24 : 59}
                  step={1}
                  allowDecimal={false}
                  allowNegative={false}
                  value={intervalValue}
                  onChange={(v) => patch({ intervalValue: typeof v === 'number' ? v : 1, scheduleMode: 'interval' })}
                  size="sm"
                  w={90}
                  style={{ flexShrink: 0 }}
                />
                <SelectDropdown
                  options={[
                    { value: 'minutes', label: t('agentflow.trigger.schedule.minutes') },
                    { value: 'hours', label: t('agentflow.trigger.schedule.hours') },
                  ]}
                  value={intervalUnit}
                  onChange={(v) => patch({ intervalUnit: v as 'minutes' | 'hours', scheduleMode: 'interval' })}
                  size="sm"
                  w={120}
                />
              </Group>
            </Stack>
          )}

          {scheduleMode === 'weekly' && (
          <Stack gap="sm" p="sm" style={INLINE_CARD}>
            <Text fz="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
              {t('agentflow.trigger.schedule.days')}
            </Text>
            <Chip.Group
              multiple
              value={weekdays.map(String)}
              onChange={(vals) => patch({ weekdays: vals.map(Number), scheduleMode: 'weekly' })}
            >
              <Group gap={4} wrap="wrap">
                {DAY_OPTIONS.map((d) => (
                  <Chip key={d.value} value={d.value} size="xs" variant="light">
                    {t(`agentflow.trigger.schedule.day.${d.key}`)}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>

            <Group gap="xs" align="center" wrap="nowrap">
              <Text fz="sm" fw={600} miw={86}>{t('agentflow.trigger.schedule.startTime')}</Text>
              <SelectDropdown
                aria-label={t('agentflow.trigger.schedule.hour')}
                options={hourOptions}
                value={String(scheduleHour)}
                onChange={(v) => patch({ scheduleHour: Number(v), scheduleMode: 'weekly' })}
                size="sm"
                withCheckIcon={false}
                w={100}
              />
              <Text fz="sm" fw={700} c="dimmed">:</Text>
              <SelectDropdown
                aria-label={t('agentflow.trigger.schedule.minute')}
                options={minuteOptions}
                value={String(scheduleMinute)}
                onChange={(v) => patch({ scheduleMinute: Number(v), scheduleMode: 'weekly' })}
                size="sm"
                withCheckIcon={false}
                w={90}
              />
            </Group>

            <ToggleSwitch
              label={t('agentflow.trigger.schedule.repeatWithinDay')}
              size="sm"
              checked={repeatWithinDay}
              onChange={(e) => patch({ repeatWithinDay: e.currentTarget.checked, scheduleMode: 'weekly' })}
            />

            {repeatWithinDay && (
              <Stack gap="xs">
                <Group gap="xs" align="center" wrap="nowrap">
                  <Text fz="sm" fw={600} miw={86}>{t('agentflow.trigger.schedule.repeatEvery')}</Text>
                  <AppNumberInput
                    aria-label={t('agentflow.trigger.schedule.repeatEvery')}
                    min={1}
                    max={repeatEveryUnit === 'hours' ? 24 : 59}
                    step={1}
                    allowDecimal={false}
                    allowNegative={false}
                    value={repeatEveryValue}
                    onChange={(v) => patch({ repeatEveryValue: typeof v === 'number' ? v : 1, scheduleMode: 'weekly' })}
                    size="sm"
                    w={90}
                    style={{ flexShrink: 0 }}
                  />
                  <SelectDropdown
                    options={[
                      { value: 'minutes', label: t('agentflow.trigger.schedule.minutes') },
                      { value: 'hours', label: t('agentflow.trigger.schedule.hours') },
                    ]}
                    value={repeatEveryUnit}
                    onChange={(v) => patch({ repeatEveryUnit: v as 'minutes' | 'hours', scheduleMode: 'weekly' })}
                    size="sm"
                    w={120}
                  />
                </Group>

                <Group gap="xs" align="center" wrap="nowrap">
                  <Text fz="sm" fw={600} miw={86}>{t('agentflow.trigger.schedule.endTime')}</Text>
                  <SelectDropdown
                    aria-label={t('agentflow.trigger.schedule.hour')}
                    options={hourOptions}
                    value={String(endHour)}
                    onChange={(v) => patch({ endHour: Number(v), scheduleMode: 'weekly' })}
                    size="sm"
                    withCheckIcon={false}
                    w={100}
                  />
                  <Text fz="sm" fw={700} c="dimmed">:</Text>
                  <SelectDropdown
                    aria-label={t('agentflow.trigger.schedule.minute')}
                    options={minuteOptions}
                    value={String(endMinute)}
                    onChange={(v) => patch({ endMinute: Number(v), scheduleMode: 'weekly' })}
                    size="sm"
                    withCheckIcon={false}
                    w={90}
                  />
                </Group>

                {endTimeInvalid && (
                  <Group gap={6} align="center">
                    <TriangleAlert size={13} color="var(--mantine-color-orange-6)" />
                    <Text fz="xs" c="orange">{t('agentflow.trigger.schedule.endTimeWarning')}</Text>
                  </Group>
                )}
              </Stack>
            )}
          </Stack>
          )}
        </Stack>
      )}

      {value.type === 'bot' && (
        <CommandTriggerFields
          kind="bot"
          value={value}
          patch={patch}
          t={t}
          showBotCompoundHint={showBotCompoundHint}
          cardStyle={INLINE_CARD}
        />
      )}

      {value.type === 'chat' && (
        <CommandTriggerFields kind="chat" value={value} patch={patch} t={t} cardStyle={INLINE_CARD} />
      )}
    </Stack>
  );
};

export interface TriggerEditorProps {
  flow: FlowDefinition;
  t: (k: string) => string;
}

export const TriggerEditor: React.FC<TriggerEditorProps> = ({ flow, t }) => {
  const { updateTrigger, addExtraTrigger, updateExtraTrigger, removeExtraTrigger } = useAgentFlowStore(
    useShallow((s) => ({
      updateTrigger: s.updateTrigger,
      addExtraTrigger: s.addExtraTrigger,
      updateExtraTrigger: s.updateExtraTrigger,
      removeExtraTrigger: s.removeExtraTrigger,
    })),
  );
  const extraTriggers = flow.extraTriggers ?? [];
  const hasNonBotTrigger = [flow.trigger, ...extraTriggers].some((tr) => tr.type !== 'bot');

  return (
    <Stack gap="md">
      <TriggerConfigForm
        value={flow.trigger}
        onChange={(next) => updateTrigger(flow.id, next)}
        t={t}
        showBotCompoundHint={hasNonBotTrigger}
      />

      <Box>
        <GroupHeader label={t('agentflow.trigger.additional')} />
        <Stack gap="sm">
          {extraTriggers.map((tr, i) => (
            <Box key={i} p="sm" style={{ ...INLINE_CARD, background: 'var(--mantine-color-bg-tertiary)' }}>
              <Group justify="space-between" align="center" mb="xs" wrap="nowrap">
                <Text fz="xs" fw={600} c="dimmed">{`${t('agentflow.trigger.additional')} ${i + 1}`}</Text>
                <Tooltip label={t('agentflow.trigger.removeTrigger')} position="left">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    aria-label={t('agentflow.trigger.removeTrigger')}
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
            {t('agentflow.trigger.addTrigger')}
          </AppButton>
        </Stack>
      </Box>
    </Stack>
  );
};
