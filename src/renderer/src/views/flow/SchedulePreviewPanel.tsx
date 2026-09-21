import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { CalendarClock, TriangleAlert } from 'lucide-react';
import type { SchedulePreview, TriggerConfig } from '../../../../shared/types';
import { describeSchedule, formatRelativeTime, formatRunTime, scheduleWarningKey } from '../../../../shared/flowSchedule';

const PREVIEW_DEBOUNCE_MS = 250;

export interface SchedulePreviewPanelProps {
  trigger: TriggerConfig;
  t: (key: string) => string;
}

/**
 * The resolved schedule, in words plus real dates. Every field above this is a guess until you can
 * read back what it actually means; the run times come from the scheduler that will run them.
 */
export const SchedulePreviewPanel: React.FC<SchedulePreviewPanelProps> = ({ trigger, t }) => {
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const signature = JSON.stringify(trigger);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void window.electronAPI.previewSchedule(JSON.parse(signature) as TriggerConfig).then((result) => {
        if (!cancelled) setPreview(result);
      }).catch(() => {
        if (!cancelled) setPreview(null);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature]);

  const warningKey = scheduleWarningKey(trigger);
  const runs = preview?.runs ?? [];
  const [first, ...rest] = runs.map((iso) => new Date(iso));

  return (
    <Stack gap={4}>
      <Group gap={6} align="center" wrap="nowrap">
        <CalendarClock size={14} color="var(--mantine-color-dimmed)" />
        <Text fz="sm" fw={600}>{describeSchedule(trigger, t)}</Text>
      </Group>

      {warningKey && (
        <Group gap={6} align="center" wrap="nowrap">
          <TriangleAlert size={13} color="var(--mantine-color-orange-6)" />
          <Text fz="xs" c="orange">{t(warningKey)}</Text>
        </Group>
      )}

      {first && (
        <Text fz="xs" c="dimmed">
          {`${t('flow.trigger.schedule.nextRun')}: ${formatRunTime(t, first)} · ${formatRelativeTime(t, first)}`}
        </Text>
      )}

      {rest.length > 0 && (
        <Text fz="xs" c="dimmed">
          {`${t('flow.trigger.schedule.thenRuns')}: ${rest.map((date) => formatRunTime(t, date)).join('  →  ')}`}
        </Text>
      )}

      {preview && runs.length === 0 && !warningKey && (
        <Text fz="xs" c="dimmed">{t('flow.trigger.schedule.noRun')}</Text>
      )}
    </Stack>
  );
};
