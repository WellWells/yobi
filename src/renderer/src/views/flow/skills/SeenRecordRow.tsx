import React, { useCallback, useEffect, useState } from 'react';
import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { AppButton } from '../../../components/AppButton';
import { ipcEvents } from '../../../api/electronApi';

/** The main-process store a step remembers what it already handed on in (`<kind>-<stepId>.json`). */
export interface SeenRecordApi {
  hasCheckpoint: (stepId: string) => Promise<boolean>;
  clearCheckpoint: (stepId: string) => Promise<boolean>;
}

/**
 * Whether the step has a record on disk, read again after every run. Clearing writes to disk at
 * once: it is not an unsaved edit of the flow and there is nothing to undo.
 */
export function useSeenRecord(stepId: string, api: SeenRecordApi): [boolean, () => Promise<void>] {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = (): void => {
      void api.hasCheckpoint(stepId).then((value) => {
        if (alive) setHas(value);
      }, () => {});
    };
    read();
    const unsubscribe = ipcEvents.onFlowExecutionEnded(read);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [stepId, api]);
  const clear = useCallback(async () => {
    await api.clearCheckpoint(stepId);
    setHas(false);
  }, [stepId, api]);
  return [has, clear];
}

export interface SeenRecordRowProps {
  /** Whether there is a record; nothing is drawn without one. */
  has: boolean;
  onClear: () => void;
  /** What the record means ("Remembers the articles already read"). */
  label: string;
  clearLabel: string;
  /** What the next run does once it is gone, in the button's tooltip. */
  clearHint: string;
  /** Said under the row when the fields changed since the card opened and the next run reseeds. */
  reseedNotice?: string;
}

/** One quiet row for a step's read record: what it is and how to forget it. */
export const SeenRecordRow: React.FC<SeenRecordRowProps> = ({ has, onClear, label, clearLabel, clearHint, reseedNotice }) => {
  if (!has) return null;
  return (
    <Stack gap={2} data-seen-record="">
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Text fz="xs" c="var(--text-muted)">{label}</Text>
        <Tooltip label={clearHint} multiline maw={280}>
          <AppButton variant="subtle" size="compact-xs" onClick={onClear} style={{ flexShrink: 0 }}>
            {clearLabel}
          </AppButton>
        </Tooltip>
      </Group>
      {reseedNotice && <Text fz="xs" c="var(--text-muted)" data-seen-reseed="">{reseedNotice}</Text>}
    </Stack>
  );
};
