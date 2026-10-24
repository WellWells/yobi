import React from 'react';
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { RotateCcw } from 'lucide-react';
import { AppButton } from '../AppButton';
import { AppTextInput } from '../AppTextInput';
import { ShortcutHint } from '../ShortcutHint';
import { useComboRecorder } from '../../shortcuts/useComboRecorder';
import type { ComboRecorder } from '../../shortcuts/useComboRecorder';
import { comboRelation } from '../../../../shared/shortcuts';
import type { ShortcutDef } from '../../../../shared/shortcuts';

export const CAPSULE_MIN_WIDTH = 132;
export const CAPSULE_PAD = 8;
const RESET_WIDTH = 26;

export type ShortcutRowLevel = 'warn' | 'refuse';

export interface ShortcutNote {
  level: ShortcutRowLevel | 'info';
  text: string;
}

type Translate = (key: string, fallback?: string) => string;

/**
 * The recorder every rebindable shortcut uses, on Keyboard shortcuts and on Export alike. There is
 * no on/off switch: Backspace or Delete alone records an empty combo, which is "off".
 */
export function useShortcutRecorder(onCommit?: (combo: string) => void): ComboRecorder {
  return useComboRecorder({
    onCommit: (combo) => onCommit?.(combo),
    allowBareKeys: true,
    clearable: true,
  });
}

/** What the line under a rebindable row says: a refused key, the recording cue, or the row's message. */
export function shortcutNote(
  recorder: Pick<ComboRecorder, 'recording' | 'rejected'>,
  message: ShortcutNote | null,
  t: Translate,
): ShortcutNote | null {
  if (recorder.rejected) return { level: 'refuse', text: t('settings.shortcut.needsModifier') };
  if (recorder.recording) return { level: 'info', text: t('settings.shortcut.recordingCue') };
  return message;
}

interface CombosProps {
  def: ShortcutDef;
  combos: readonly string[];
  primaryMuted: boolean;
  t: Translate;
}

/** A row's keycaps, with "or" / "／" between combos as the registry says. */
export const ShortcutCombos: React.FC<CombosProps> = ({ def, combos, primaryMuted, t }) => {
  const separator = t(comboRelation(def) === 'each' ? 'settings.shortcut.separator.each' : 'settings.shortcut.separator.or');
  return (
    <>
      {combos.map((combo, index) => (
        <React.Fragment key={combo}>
          {index > 0 && (
            <Text component="span" fz="var(--font-size-xs)" c="var(--text-muted)" style={{ flexShrink: 0 }}>
              {separator}
            </Text>
          )}
          <ShortcutHint combo={combo} muted={index === 0 ? primaryMuted : true} />
        </React.Fragment>
      ))}
    </>
  );
};

interface ControlProps {
  def: ShortcutDef;
  label: string;
  combos: readonly string[];
  /** The combo differs from the default, an empty one included: ↺ puts the default back. */
  modified?: boolean;
  recorder: ComboRecorder;
  t: Translate;
  onStartRecording?: () => void;
  onReset?: () => void;
}

/** ↺ and the clickable capsule; an empty combo reads "Not set" and records on click like any other. */
export const ShortcutRecorderControl: React.FC<ControlProps> = ({
  def, label, combos, modified, recorder, t, onStartRecording, onReset,
}) => {
  const resetLabel = t('settings.shortcut.resetRow');
  return (
    <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
      <Box w={RESET_WIDTH} style={{ flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        {modified && onReset && !recorder.recording && (
          <Tooltip label={resetLabel} position="top" withArrow>
            <ActionIcon variant="subtle" size={22} onClick={onReset} aria-label={resetLabel}>
              <RotateCcw size={12} />
            </ActionIcon>
          </Tooltip>
        )}
      </Box>
      <Box miw={CAPSULE_MIN_WIDTH} style={{ flexShrink: 0 }}>
        {recorder.recording ? (
          <AppTextInput
            readOnly
            autoFocus
            mono
            size="xs"
            tone={recorder.rejected ? 'default' : 'recording'}
            value={recorder.draft}
            aria-label={t('settings.shortcut.recordingCue')}
            onKeyDown={recorder.handleKeyDown}
            onBlur={recorder.stop}
          />
        ) : (
          <AppButton
            variant="subtle"
            size="xs"
            fullWidth
            justify="flex-end"
            px={CAPSULE_PAD}
            onClick={() => { onStartRecording?.(); recorder.start(); }}
            aria-label={label}
          >
            {combos.length > 0 ? (
              <Group gap={6} wrap="nowrap" justify="flex-end">
                <ShortcutCombos def={def} combos={combos} primaryMuted={false} t={t} />
              </Group>
            ) : (
              <Text fz="var(--font-size-xs)" c="dimmed">{t('settings.shortcut.unbound')}</Text>
            )}
          </AppButton>
        )}
      </Box>
    </Group>
  );
};

const NOTE_COLOR: Record<ShortcutNote['level'], string> = {
  refuse: 'var(--error)',
  warn: 'var(--warning)',
  info: 'var(--text-muted)',
};

/** The line that opens under a row while recording, or for a refused or doubtful combo. */
export const ShortcutNoteLine: React.FC<{ note: ShortcutNote | null }> = ({ note }) => (
  <Box
    style={{
      display: 'grid',
      gridTemplateRows: note ? '1fr' : '0fr',
      transition: 'grid-template-rows 160ms ease',
    }}
  >
    <Box style={{ minHeight: 0, overflow: 'hidden' }}>
      <Text fz="var(--font-size-xs)" pb={6} c={note ? NOTE_COLOR[note.level] : undefined}>
        {note?.text ?? ''}
      </Text>
    </Box>
  </Box>
);
