import React, { useCallback, useMemo } from 'react';
import { Box, Chip, Group, Stack, Text } from '@mantine/core';
import { Bot, TriangleAlert } from 'lucide-react';
import { useAgentFlowStore } from '../../store/useAgentFlowStore';
import { normalizeCronTrigger } from '../../../../shared/flowSchedule';
import { AppNumberInput } from '../../components/AppNumberInput';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';
import { AppTextInput } from '../../components/AppTextInput';
import { SelectDropdown } from '../../components/SelectDropdown';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import type { FlowDefinition, TriggerConfig, TriggerType } from '../../../../shared/types';
import { HotkeyRecorder } from './HotkeyRecorder';

const DAY_OPTIONS = [
  { value: '0', key: 'sun' },
  { value: '1', key: 'mon' },
  { value: '2', key: 'tue' },
  { value: '3', key: 'wed' },
  { value: '4', key: 'thu' },
  { value: '5', key: 'fri' },
  { value: '6', key: 'sat' },
] as const;

export interface TriggerEditorProps {
  flow: FlowDefinition;
  t: (k: string) => string;
}

export const TriggerEditor: React.FC<TriggerEditorProps> = ({ flow, t }) => {
  const { updateTrigger } = useAgentFlowStore();

  const weekdays = flow.trigger.weekdays ?? [1, 2, 3, 4, 5];
  const scheduleHour = flow.trigger.scheduleHour ?? 9;
  const scheduleMinute = flow.trigger.scheduleMinute ?? 0;
  const repeatWithinDay = flow.trigger.repeatWithinDay ?? false;
  const repeatEveryValue = flow.trigger.repeatEveryValue ?? 1;
  const repeatEveryUnit = flow.trigger.repeatEveryUnit ?? 'hours';
  const endHour = flow.trigger.endHour ?? 18;
  const endMinute = flow.trigger.endMinute ?? 0;

  const botCommandEmpty = flow.trigger.type === 'bot' && !flow.trigger.botCommand?.trim();
  const botInputVariableRaw = (flow.trigger.botInputVariable ?? '').trim();
  const botInputVariable = botInputVariableRaw
    ? botInputVariableRaw
    : t('agentflow.trigger.bot.inputVariable.placeholder');
  const botInputVariableHint = t('agentflow.trigger.bot.inputVariable.hint')
    .replace(/\{\{(input|variable)\}\}/g, botInputVariable);

  const endTimeInvalid = repeatWithinDay
    && (endHour * 60 + endMinute) <= (scheduleHour * 60 + scheduleMinute);

  const patchTrigger = useCallback((patch: Partial<TriggerConfig>) => {
    const next = { ...flow.trigger, ...patch };
    if (next.type === 'cron') {
      updateTrigger(flow.id, normalizeCronTrigger(next));
      return;
    }
    updateTrigger(flow.id, next);
  }, [flow.trigger, flow.id, updateTrigger]);

  const triggerOptions = useMemo(() => [
    { value: 'manual', label: t('agentflow.trigger.manual') },
    { value: 'hotkey', label: t('agentflow.trigger.hotkey') },
    { value: 'cron', label: t('agentflow.trigger.cron') },
    { value: 'bot', label: t('agentflow.trigger.bot') },
  ], [t]);

  const hourOptions = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, '0') })), []);

  const minuteOptions = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, '0') })), []);

  return (
    <Stack gap="sm">
      <AppSegmentedControl
        value={flow.trigger.type}
        options={triggerOptions}
        onChange={(value) => patchTrigger({ type: value as TriggerType })}
        size="sm"
      />

      {flow.trigger.type === 'hotkey' && (
        <Box pt="xs">
          <HotkeyRecorder
            value={flow.trigger.keys ?? ''}
            onChange={(keys) => patchTrigger({ keys })}
            t={t}
          />
        </Box>
      )}

      {flow.trigger.type === 'cron' && (
        <Stack gap="xs">
          <Stack
            gap="sm"
            p="sm"
            style={{
              background: 'var(--mantine-color-default)',
              borderRadius: 'var(--mantine-radius-md)',
              border: '1px solid var(--mantine-color-default-border)',
            }}
          >
            <Text fz="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
              {t('agentflow.trigger.schedule.days')}
            </Text>
            <Chip.Group
              multiple
              value={weekdays.map(String)}
              onChange={(vals) => patchTrigger({ weekdays: vals.map(Number), scheduleMode: 'weekly' })}
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
                onChange={(v) => patchTrigger({ scheduleHour: Number(v), scheduleMode: 'weekly' })}
                size="sm"
                withCheckIcon={false}
                w={100}
              />
              <Text fz="sm" fw={700} c="dimmed">:</Text>
              <SelectDropdown
                aria-label={t('agentflow.trigger.schedule.minute')}
                options={minuteOptions}
                value={String(scheduleMinute)}
                onChange={(v) => patchTrigger({ scheduleMinute: Number(v), scheduleMode: 'weekly' })}
                size="sm"
                withCheckIcon={false}
                w={90}
              />
            </Group>

            <ToggleSwitch
              label={t('agentflow.trigger.schedule.repeatWithinDay')}
              size="sm"
              checked={repeatWithinDay}
              onChange={(e) => patchTrigger({ repeatWithinDay: e.currentTarget.checked, scheduleMode: 'weekly' })}
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
                    onChange={(v) => patchTrigger({ repeatEveryValue: typeof v === 'number' ? v : 1, scheduleMode: 'weekly' })}
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
                    onChange={(v) => patchTrigger({ repeatEveryUnit: v as 'minutes' | 'hours', scheduleMode: 'weekly' })}
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
                    onChange={(v) => patchTrigger({ endHour: Number(v), scheduleMode: 'weekly' })}
                    size="sm"
                    withCheckIcon={false}
                    w={100}
                  />
                  <Text fz="sm" fw={700} c="dimmed">:</Text>
                  <SelectDropdown
                    aria-label={t('agentflow.trigger.schedule.minute')}
                    options={minuteOptions}
                    value={String(endMinute)}
                    onChange={(v) => patchTrigger({ endMinute: Number(v), scheduleMode: 'weekly' })}
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
        </Stack>
      )}

      {flow.trigger.type === 'bot' && (
        <Stack
          gap="sm"
          p="sm"
          style={{
            background: 'var(--mantine-color-default)',
            borderRadius: 'var(--mantine-radius-md)',
            border: '1px solid var(--mantine-color-default-border)',
          }}
        >
          <Group gap={6} align="center">
            <Bot size={13} color="var(--mantine-color-dimmed)" />
            <Text fz="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.05em' }}>
              {t('agentflow.trigger.bot.section')}
            </Text>
          </Group>

          <AppTextInput
            label={t('agentflow.trigger.bot.command')}
            description={t('agentflow.trigger.bot.command.hint')}
            placeholder={t('agentflow.trigger.bot.command.placeholder')}
            value={flow.trigger.botCommand ?? ''}
            onChange={(e) => patchTrigger({ botCommand: e.currentTarget.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() })}
            leftSection={<Text fz="sm" c="dimmed">/</Text>}
            mono
            tone="body"
            size="sm"
          />

          <AppTextInput
            label={t('common.description')}
            placeholder={t('agentflow.trigger.bot.description.placeholder')}
            value={flow.trigger.botCommandDescription ?? ''}
            onChange={(e) => patchTrigger({ botCommandDescription: e.currentTarget.value })}
            tone="body"
            size="sm"
          />

          <AppTextInput
            label={t('agentflow.trigger.bot.inputVariable')}
            description={botInputVariableHint}
            placeholder={t('agentflow.trigger.bot.inputVariable.placeholder')}
            value={flow.trigger.botInputVariable ?? ''}
            onChange={(e) => patchTrigger({ botInputVariable: e.currentTarget.value.replace(/[^a-zA-Z0-9_.]/g, '') })}
            mono
            tone="body"
            size="sm"
          />

          {botCommandEmpty && (
            <Group gap={6} align="center">
              <TriangleAlert size={13} color="var(--mantine-color-orange-6)" />
              <Text fz="xs" c="orange">{t('agentflow.trigger.bot.command.empty')}</Text>
            </Group>
          )}
        </Stack>
      )}
    </Stack>
  );
};

