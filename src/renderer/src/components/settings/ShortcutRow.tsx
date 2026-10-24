import React from 'react';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  CAPSULE_MIN_WIDTH, CAPSULE_PAD, ShortcutCombos, ShortcutNoteLine, ShortcutRecorderControl,
  shortcutNote, useShortcutRecorder,
} from './ShortcutRecorder';
import type { ShortcutRowLevel } from './ShortcutRecorder';
import type { ShortcutDef } from '../../../../shared/shortcuts';

export type { ShortcutRowLevel };

export interface ShortcutRowProps {
  def: ShortcutDef;
  label: string;
  hint?: string;
  combos: readonly string[];
  message: { level: ShortcutRowLevel; text: string } | null;
  modified?: boolean;
  t: (key: string, fallback?: string) => string;
  onStartRecording?: () => void;
  onCommit?: (combo: string) => void;
  onReset?: () => void;
}

/**
 * One row of Keyboard shortcuts. A rebindable row is its capsule and ↺ — no on/off switch, no
 * column kept for one: an empty combo is how a shortcut is off. A locked row shows muted keycaps.
 */
export const ShortcutRow: React.FC<ShortcutRowProps> = ({
  def, label, hint, combos, message, modified, t,
  onCommit, onReset, onStartRecording,
}) => {
  const recorder = useShortcutRecorder(onCommit);

  return (
    <Box>
      <Group gap={8} wrap="nowrap" align="center" py={hint ? 7 : 5}>
        <Stack gap={1} flex={1} style={{ minWidth: 0 }}>
          <Text fz="var(--font-size-sm)" truncate>{label}</Text>
          {hint && <Text fz="var(--font-size-xs)" c="dimmed" lh={1.5}>{hint}</Text>}
        </Stack>

        {def.rebindable ? (
          <ShortcutRecorderControl
            def={def}
            label={label}
            combos={combos}
            modified={modified}
            recorder={recorder}
            t={t}
            onStartRecording={onStartRecording}
            onReset={onReset}
          />
        ) : (
          <Tooltip label={t(def.lockReasonKey ?? '')} position="top" withArrow>
            <Group gap={6} wrap="nowrap" miw={CAPSULE_MIN_WIDTH} pr={CAPSULE_PAD} justify="flex-end" style={{ flexShrink: 0 }}>
              <ShortcutCombos def={def} combos={combos} primaryMuted t={t} />
            </Group>
          </Tooltip>
        )}
      </Group>

      <ShortcutNoteLine note={def.rebindable ? shortcutNote(recorder, message, t) : message} />
    </Box>
  );
};
